import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { logger } from '#o11y/logger';
import type { CodeReviewConfig, CodeReviewFileExtensions, CodeReviewRequires } from '#shared/codeReview/codeReview.model';
import type { IExample as CodeReviewExample } from '#shared/codeReview/codeReview.model'; // Renamed for clarity if IExample is too generic
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import type { CodeReviewFingerprintCache } from '#swe/codeReview/codeReviewTaskModel';
import { EMPTY_CACHE } from '#swe/codeReview/codeReviewTaskModel';
import type { Database } from './db'; // CodeReviewConfigsTable and MergeRequestReviewCacheTable are implicitly used via Database type
import { db } from './db'; // Main Kysely instance

export class PostgresCodeReviewService implements CodeReviewService {
	private readonly kysely: Kysely<Database>;

	constructor() {
		this.kysely = db; // Use the shared db instance
	}

	// Helper for JSON serialization
	private stringifyOrNull(value: any): string | null {
		if (value === undefined || value === null) return null;
		return JSON.stringify(value);
	}
	// Helper for JSON deserialization
	private parseOrNull<T>(jsonString: string | null | undefined): T | null {
		if (jsonString === null || jsonString === undefined) return null;
		try {
			return JSON.parse(jsonString) as T;
		} catch (error) {
			logger.error({ error, jsonStringValue: jsonString }, 'Failed to parse JSON string');
			return null;
		}
	}

	async getCodeReviewConfig(id: string): Promise<CodeReviewConfig | null> {
		logger.debug({ id }, 'PostgresCodeReviewService.getCodeReviewConfig called');
		const result = await this.kysely.selectFrom('code_review_configs').selectAll().where('id', '=', id).executeTakeFirst();

		if (!result) {
			return null;
		}

		return {
			id: result.id,
			title: result.title,
			description: result.description, // Already nullable
			enabled: result.enabled,
			fileExtensions: this.parseOrNull<CodeReviewFileExtensions>(result.file_extensions_serialized),
			requires: this.parseOrNull<CodeReviewRequires>(result.requires_serialized),
			tags: this.parseOrNull<string[]>(result.tags_serialized) ?? [],
			projectPaths: this.parseOrNull<string[]>(result.project_paths_serialized) ?? [],
			examples: this.parseOrNull<CodeReviewExample[]>(result.examples_serialized) ?? [],
			// created_at and updated_at are part of the table but not directly in CodeReviewConfig model
		};
	}

	async listCodeReviewConfigs(): Promise<CodeReviewConfig[]> {
		logger.debug('PostgresCodeReviewService.listCodeReviewConfigs called');
		const results = await this.kysely.selectFrom('code_review_configs').selectAll().orderBy('title', 'asc').execute();

		return results.map((result) => ({
			id: result.id,
			title: result.title,
			description: result.description,
			enabled: result.enabled,
			fileExtensions: this.parseOrNull<CodeReviewFileExtensions>(result.file_extensions_serialized),
			requires: this.parseOrNull<CodeReviewRequires>(result.requires_serialized),
			tags: this.parseOrNull<string[]>(result.tags_serialized) ?? [],
			projectPaths: this.parseOrNull<string[]>(result.project_paths_serialized) ?? [],
			examples: this.parseOrNull<CodeReviewExample[]>(result.examples_serialized) ?? [],
		}));
	}

	async createCodeReviewConfig(configData: Omit<CodeReviewConfig, 'id'>): Promise<string> {
		const newId = randomUUID();
		logger.debug({ id: newId }, 'PostgresCodeReviewService.createCodeReviewConfig called');

		const newRecord = {
			id: newId,
			title: configData.title,
			description: configData.description ?? null,
			enabled: configData.enabled,
			file_extensions_serialized: this.stringifyOrNull(configData.fileExtensions),
			requires_serialized: this.stringifyOrNull(configData.requires),
			tags_serialized: this.stringifyOrNull(configData.tags),
			project_paths_serialized: this.stringifyOrNull(configData.projectPaths),
			examples_serialized: this.stringifyOrNull(configData.examples),
			// created_at and updated_at are expected to be handled by DB defaults/triggers
		};

		await this.kysely.insertInto('code_review_configs').values(newRecord).execute();

		return newId;
	}

	async updateCodeReviewConfig(id: string, configData: Partial<Omit<CodeReviewConfig, 'id'>>): Promise<void> {
		logger.debug({ id, configDataKeys: Object.keys(configData) }, 'PostgresCodeReviewService.updateCodeReviewConfig called');
		if (Object.keys(configData).length === 0) {
			logger.warn({ id }, 'Update called with empty configData, no changes will be made.');
			return;
		}

		const updateRecord: Record<string, any> = {}; // Build dynamic update object

		if (configData.title !== undefined) updateRecord.title = configData.title;
		if (Object.prototype.hasOwnProperty.call(configData, 'description')) updateRecord.description = configData.description;
		if (configData.enabled !== undefined) updateRecord.enabled = configData.enabled;
		if (Object.prototype.hasOwnProperty.call(configData, 'fileExtensions'))
			updateRecord.file_extensions_serialized = this.stringifyOrNull(configData.fileExtensions);
		if (Object.prototype.hasOwnProperty.call(configData, 'requires')) updateRecord.requires_serialized = this.stringifyOrNull(configData.requires);
		if (Object.prototype.hasOwnProperty.call(configData, 'tags')) updateRecord.tags_serialized = this.stringifyOrNull(configData.tags);
		if (Object.prototype.hasOwnProperty.call(configData, 'projectPaths')) updateRecord.project_paths_serialized = this.stringifyOrNull(configData.projectPaths);
		if (Object.prototype.hasOwnProperty.call(configData, 'examples')) updateRecord.examples_serialized = this.stringifyOrNull(configData.examples);

		if (Object.keys(updateRecord).length === 0) {
			logger.warn({ id }, 'After mapping, updateRecord is empty. No database update will be performed.');
			return;
		}

		const result = await this.kysely
			.updateTable('code_review_configs')
			.set({ ...updateRecord, updated_at: sql`CURRENT_TIMESTAMP` }) // Explicitly set updated_at
			.where('id', '=', id)
			.executeTakeFirst(); // Changed from execute() to executeTakeFirst() for numUpdatedRows

		if (result && result.numUpdatedRows === 0n) {
			logger.warn({ id }, 'No rows updated for CodeReviewConfig, ID might not exist.');
		}
	}

	async deleteCodeReviewConfig(id: string): Promise<void> {
		logger.debug({ id }, 'PostgresCodeReviewService.deleteCodeReviewConfig called');
		await this.kysely.deleteFrom('code_review_configs').where('id', '=', id).execute();
	}

	async getMergeRequestReviewCache(projectId: string | number, mrIid: number): Promise<CodeReviewFingerprintCache> {
		logger.debug({ projectId, mrIid }, 'PostgresCodeReviewService.getMergeRequestReviewCache called');
		const result = await this.kysely
			.selectFrom('merge_request_review_cache')
			.selectAll()
			.where('project_id', '=', String(projectId))
			.where('mr_iid', '=', mrIid)
			.executeTakeFirst();

		if (!result) {
			return EMPTY_CACHE();
		}

		const fingerprintsArray = this.parseOrNull<string[]>(result.fingerprints_serialized);
		let lastUpdatedTimestamp: number;

		if (result.last_updated instanceof Date) {
			lastUpdatedTimestamp = result.last_updated.getTime();
		} else {
			// Attempt to parse if it's a string
			lastUpdatedTimestamp = Date.parse(result.last_updated as unknown as string);
			if (Number.isNaN(lastUpdatedTimestamp)) {
				logger.warn({ projectId, mrIid, lastUpdatedValue: result.last_updated }, 'Failed to parse last_updated as Date, using current time as fallback.');
				lastUpdatedTimestamp = Date.now(); // Fallback
			}
		}

		return {
			lastUpdated: lastUpdatedTimestamp,
			fingerprints: fingerprintsArray ? new Set(fingerprintsArray) : new Set<string>(),
		};
	}

	async updateMergeRequestReviewCache(projectId: string | number, mrIid: number, cacheObject: CodeReviewFingerprintCache): Promise<void> {
		logger.debug({ projectId, mrIid, fingerprintCount: cacheObject.fingerprints.size }, 'PostgresCodeReviewService.updateMergeRequestReviewCache called');
		const strProjectId = String(projectId);
		const now = new Date();

		const dataToUpsert = {
			project_id: strProjectId,
			mr_iid: mrIid,
			last_updated: now,
			fingerprints_serialized: JSON.stringify(Array.from(cacheObject.fingerprints)),
			// created_at and updated_at are expected to be handled by DB defaults/triggers
			// or by the ON CONFLICT clause for updated_at
		};

		await this.kysely
			.insertInto('merge_request_review_cache')
			.values(dataToUpsert)
			.onConflict((oc) =>
				oc.columns(['project_id', 'mr_iid']).doUpdateSet({
					last_updated: now,
					fingerprints_serialized: dataToUpsert.fingerprints_serialized,
					updated_at: sql`CURRENT_TIMESTAMP`, // Ensure updated_at is touched on conflict
				}),
			)
			.execute();
	}
}
