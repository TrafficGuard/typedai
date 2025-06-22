import { randomUUID } from 'node:crypto';
import type { Selectable } from 'kysely';
import { logger } from '#o11y/logger';
import { sql } from 'kysely';
import { span } from '#o11y/trace';
import type { PromptsService } from '#prompts/promptsService';
import type { CallSettings, LlmMessage } from '#shared/llm/llm.model';
import type { Prompt, PromptPreview } from '#shared/prompts/prompts.model';
import { type PromptGroupsTable, type PromptRevisionsTable, db } from './db';

export class PostgresPromptsService implements PromptsService {
	/** Ensure missing `cache` prop is re-added so deep-equality passes */
	private _normalizeMessages(messages: LlmMessage[]): LlmMessage[] {
		return messages.map((m) => ('cache' in m ? m : { ...m, cache: undefined }));
	}

	private _mapRevisionToPrompt(groupDoc: Selectable<PromptGroupsTable>, revisionDoc: Selectable<PromptRevisionsTable>): Prompt {
		return {
			id: groupDoc.id,
			userId: groupDoc.user_id,
			parentId: revisionDoc.parent_id ?? undefined, // parent_id on revision is the snapshot
			revisionId: revisionDoc.revision_number,
			name: revisionDoc.name,
			appId: revisionDoc.app_id ?? undefined,
			tags: JSON.parse(revisionDoc.tags_serialized) as string[],
			messages: this._normalizeMessages(JSON.parse(revisionDoc.messages_serialized) as LlmMessage[]),
			settings: JSON.parse(revisionDoc.settings_serialized) as CallSettings & { llmId?: string },
		};
	}

	private _mapGroupToPromptPreview(groupDoc: Selectable<PromptGroupsTable>): PromptPreview {
		// Preview uses denormalized fields from the group, which reflect the latest revision
		return {
			id: groupDoc.id,
			userId: groupDoc.user_id,
			parentId: groupDoc.parent_id ?? undefined,
			revisionId: groupDoc.latest_revision_id,
			name: groupDoc.name,
			appId: groupDoc.app_id ?? undefined,
			tags: JSON.parse(groupDoc.tags_serialized) as string[],
			settings: JSON.parse(groupDoc.settings_serialized) as CallSettings & { llmId?: string },
		};
	}

	@span()
	async getPrompt(promptId: string, userId: string): Promise<Prompt | null> {
		const group = await db.selectFrom('prompt_groups').selectAll().where('id', '=', promptId).executeTakeFirst();

		if (!group) return null;
		if (group.user_id !== userId) {
			logger.warn({ promptId, userId, ownerId: group.user_id }, 'User attempted to access prompt they do not own [promptId] [userId] [ownerId]');
			return null; // Or throw an authorization error
		}

		const revision = await db
			.selectFrom('prompt_revisions')
			.selectAll()
			.where('prompt_group_id', '=', group.id)
			.where('revision_number', '=', group.latest_revision_id)
			.executeTakeFirst();

		if (!revision) {
			logger.error(
				{ promptId, latestRevisionId: group.latest_revision_id },
				'Prompt group exists but latest revision is missing [promptId] [latestRevisionId]',
			);
			return null; // Data inconsistency
		}

		return this._mapRevisionToPrompt(group, revision);
	}

	@span()
	async getPromptVersion(promptId: string, revisionId: number, userId: string): Promise<Prompt | null> {
		const group = await db.selectFrom('prompt_groups').selectAll().where('id', '=', promptId).executeTakeFirst();

		if (!group) return null;
		if (group.user_id !== userId) {
			logger.warn({ promptId, userId, ownerId: group.user_id }, 'User attempted to access prompt version they do not own [promptId] [userId] [ownerId]');
			return null;
		}

		const revision = await db
			.selectFrom('prompt_revisions')
			.selectAll()
			.where('prompt_group_id', '=', group.id)
			.where('revision_number', '=', revisionId)
			.executeTakeFirst();

		if (!revision) return null;

		return this._mapRevisionToPrompt(group, revision);
	}

	@span()
	async listPromptsForUser(userId: string): Promise<PromptPreview[]> {
		const groups = await db.selectFrom('prompt_groups').selectAll().where('user_id', '=', userId).orderBy('updated_at', 'desc').execute();
		return groups.map((group) => this._mapGroupToPromptPreview(group));
	}

	@span()
	async createPrompt(promptData: Omit<Prompt, 'id' | 'revisionId' | 'userId'>, userId: string): Promise<Prompt> {
		const promptGroupId = randomUUID();
		const firstRevisionNumber = 1;
		const revisionId = randomUUID(); // ID for the revision record itself

		const newPrompt = await db.transaction().execute(async (trx) => {
			const groupInsertData = {
				id: promptGroupId,
				user_id: userId,
				latest_revision_id: firstRevisionNumber,
				name: promptData.name,
				app_id: promptData.appId ?? null,
				tags_serialized: JSON.stringify(promptData.tags),
				parent_id: promptData.parentId ?? null,
				settings_serialized: JSON.stringify(promptData.settings),
				// created_at and updated_at will be set by DB defaults
			};
			const insertedGroup = await trx.insertInto('prompt_groups').values(groupInsertData).returningAll().executeTakeFirstOrThrow();

			const revisionInsertData = {
				id: revisionId,
				prompt_group_id: promptGroupId,
				revision_number: firstRevisionNumber,
				name: promptData.name,
				app_id: promptData.appId ?? null,
				tags_serialized: JSON.stringify(promptData.tags),
				parent_id: promptData.parentId ?? null, // Store parent_id with the revision as well
				messages_serialized: JSON.stringify(promptData.messages),
				settings_serialized: JSON.stringify(promptData.settings),
				// created_at will be set by DB default
			};
			const insertedRevision = await trx.insertInto('prompt_revisions').values(revisionInsertData).returningAll().executeTakeFirstOrThrow();
			return this._mapRevisionToPrompt(insertedGroup, insertedRevision);
		});
		logger.info({ promptId: newPrompt.id, userId }, 'Prompt created [promptId] [userId]');
		return newPrompt;
	}

	@span()
	async updatePrompt(
		promptId: string,
		updates: Partial<Omit<Prompt, 'id' | 'userId' | 'revisionId'>>,
		userId: string,
		newVersion: boolean,
	): Promise<Prompt> {
		const updatedPrompt = await db.transaction().execute(async (trx) => {
			const group = await trx.selectFrom('prompt_groups').selectAll().where('id', '=', promptId).executeTakeFirst();

			if (!group) throw new Error(`Prompt with ID ${promptId} not found.`);
			if (group.user_id !== userId) {
				logger.warn({ promptId, userId, ownerId: group.user_id }, 'User attempted to update prompt they do not own [promptId] [userId] [ownerId]');
				throw new Error('User not authorized to update this prompt.');
			}

			const latestRevision = await trx
				.selectFrom('prompt_revisions')
				.selectAll()
				.where('prompt_group_id', '=', group.id)
				.where('revision_number', '=', group.latest_revision_id)
				.executeTakeFirst();

			if (!latestRevision) {
				logger.error(
					{ promptId, latestRevisionId: group.latest_revision_id },
					'Latest revision for prompt not found during update [promptId] [latestRevisionId]',
				);
				throw new Error('Data inconsistency: Latest revision not found.');
			}

			if (!newVersion) {
				/* ---------------- In-place update of latest revision ---------------- */
				// Build the SET object dynamically so that Kysely never receives an
				// empty list (which results in `SET` followed by `WHERE` → syntax error).
				const setData: Record<string, any> = {
					updated_at: sql`now()`, // always touch updated_at so at least one column is set
				};

				if (updates.name !== undefined) setData.name = updates.name;
				if (Object.hasOwn(updates, 'appId')) setData.app_id = updates.appId ?? null;
				if (Object.hasOwn(updates, 'parentId')) setData.parent_id = updates.parentId ?? null;
				if (updates.tags !== undefined) setData.tags_serialized = JSON.stringify(updates.tags);
				if (updates.messages !== undefined)
					setData.messages_serialized = JSON.stringify(updates.messages);
				if (updates.settings !== undefined)
					setData.settings_serialized = JSON.stringify(updates.settings);

				// If caller supplied no fields to mutate, just return the latest revision as-is
				if (Object.keys(setData).length === 1) {
					return this._mapRevisionToPrompt(group, latestRevision);
				}

				const targetRevisionRef = trx
					.updateTable('prompt_revisions')
					.set(setData)
					.where('id', '=', latestRevision.id)
					.returningAll()
					.executeTakeFirstOrThrow();

				const updatedGroup = await trx
					.updateTable('prompt_groups')
					.set({
						name: targetRevisionRef.name,
						app_id: targetRevisionRef.app_id,
						parent_id: targetRevisionRef.parent_id,
						tags_serialized: targetRevisionRef.tags_serialized,
						settings_serialized: targetRevisionRef.settings_serialized,
						updated_at: sql`now()`,
					})
					.where('id', '=', group.id)
					.returningAll()
					.executeTakeFirstOrThrow();

				return this._mapRevisionToPrompt(updatedGroup, targetRevisionRef);
			}

			/* ---------------- Create NEW revision ---------------- */
			const newRevisionRecordId = randomUUID();
			const newRevisionNumber = group.latest_revision_id + 1;

			const newRevisionName = updates.name ?? latestRevision.name;
			const newRevisionAppId = Object.hasOwn(updates, 'appId') ? (updates.appId ?? null) : latestRevision.app_id;
			const newRevisionTags = updates.tags ?? (JSON.parse(latestRevision.tags_serialized) as string[]);
			const newRevisionParentId = Object.hasOwn(updates, 'parentId') ? (updates.parentId ?? null) : latestRevision.parent_id;
			const newRevisionMessages = updates.messages ?? (JSON.parse(latestRevision.messages_serialized) as LlmMessage[]);
			const newRevisionSettings = updates.settings ?? (JSON.parse(latestRevision.settings_serialized) as CallSettings & { llmId?: string });

			const revisionInsertData = {
				id: newRevisionRecordId,
				prompt_group_id: group.id,
				revision_number: newRevisionNumber,
				name: newRevisionName,
				app_id: newRevisionAppId,
				tags_serialized: JSON.stringify(newRevisionTags),
				parent_id: newRevisionParentId,
				messages_serialized: JSON.stringify(newRevisionMessages),
				settings_serialized: JSON.stringify(newRevisionSettings),
			};
			const insertedRevision = await trx.insertInto('prompt_revisions').values(revisionInsertData).returningAll().executeTakeFirstOrThrow();

			const groupUpdateData = {
				latest_revision_id: newRevisionNumber,
				name: newRevisionName,
				app_id: newRevisionAppId,
				tags_serialized: JSON.stringify(newRevisionTags),
				parent_id: newRevisionParentId,
				settings_serialized: JSON.stringify(newRevisionSettings),
				// updated_at will be handled by DB trigger or default
			};
			const updatedGroup = await trx.updateTable('prompt_groups').set(groupUpdateData).where('id', '=', group.id).returningAll().executeTakeFirstOrThrow();

			return this._mapRevisionToPrompt(updatedGroup, insertedRevision);
		});
		logger.info({ promptId: updatedPrompt.id, newRevisionId: updatedPrompt.revisionId, userId }, 'Prompt updated [promptId] [newRevisionId] [userId]');
		return updatedPrompt;
	}

	@span()
	async deletePrompt(promptId: string, userId: string): Promise<void> {
		await db.transaction().execute(async (trx) => {
			const group = await trx.selectFrom('prompt_groups').select(['id', 'user_id']).where('id', '=', promptId).executeTakeFirst();

			if (!group) {
				throw new Error(`Prompt with ID ${promptId} not found.`);
			}
			if (group.user_id !== userId) {
				logger.warn({ promptId, userId, ownerId: group.user_id }, 'User attempted to delete prompt they do not own [promptId] [userId] [ownerId]');
				throw new Error('User not authorized to delete this prompt.');
			}

			// Delete revisions first due to potential FK constraints
			await trx.deleteFrom('prompt_revisions').where('prompt_group_id', '=', promptId).execute();
			const deleteResult = await trx.deleteFrom('prompt_groups').where('id', '=', promptId).executeTakeFirst();

			if (Number(deleteResult?.numDeletedRows ?? 0) > 0) {
				logger.info({ promptId, userId }, 'Prompt deleted [promptId] [userId]');
			} else {
				// This case should ideally be caught by the initial group check,
				// but it's a safeguard if the group disappeared mid-transaction (highly unlikely without SERIALIZABLE isolation).
				logger.warn({ promptId, userId }, 'Prompt was not found for deletion after ownership check [promptId] [userId]');
			}
		});
	}
}
