import { FieldValue, Firestore, type Timestamp, type WriteBatch } from '@google-cloud/firestore';
import { logger } from '#o11y/logger';
import type { PromptsService } from '#prompts/promptsService';
import type { CallSettings, LlmMessage } from '#shared/model/llm.model';
import type { Prompt, PromptPreview } from '#shared/model/prompts.model';
import { envVar } from '#utils/env-var';

const PROMPTS_COLLECTION = 'Prompts';
const REVISIONS_SUBCOLLECTION = 'Revisions';

// Interface for the document stored in the PROMPTS_COLLECTION
interface PromptGroupDoc {
	userId: string;
	latestRevisionId: number;
	// Denormalized fields from the latest revision for preview
	name: string;
	appId?: string | null; // Allow null for optional fields
	tags: string[];
	parentId?: string | null; // Allow null
	options: CallSettings;
	// Timestamps for the group itself
	createdAt: Timestamp;
	updatedAt: Timestamp;
}

// Interface for the document stored in the REVISIONS_SUBCOLLECTION
interface RevisionDoc {
	// Fields specific to this revision
	messages: LlmMessage[];
	options: CallSettings;
	name: string;
	appId?: string | null; // Allow null
	tags: string[];
	parentId?: string | null; // Allow null
	// Metadata for the revision
	promptId: string;
	revisionId: number;
	userId: string;
	createdAt: Timestamp;
}

export class FirebasePromptService implements PromptsService {
	private db: Firestore;

	constructor() {
		this.db = new Firestore({
			projectId: process.env.FIRESTORE_EMULATOR_HOST ? 'demo-typedai' : envVar('GCLOUD_PROJECT'),
			databaseId: process.env.FIRESTORE_DATABASE,
			ignoreUndefinedProperties: true,
		});
	}

	// Helper to convert a RevisionDoc and its parent PromptGroupDoc's ID to a Prompt object
	private _toPrompt(promptGroupId: string, revisionDocData: RevisionDoc): Prompt {
		return {
			id: promptGroupId,
			userId: revisionDocData.userId,
			parentId: revisionDocData.parentId === null ? undefined : revisionDocData.parentId,
			revisionId: revisionDocData.revisionId,
			name: revisionDocData.name,
			appId: revisionDocData.appId === null ? undefined : revisionDocData.appId,
			tags: revisionDocData.tags,
			messages: revisionDocData.messages,
			settings: revisionDocData.options,
		};
	}

	// Helper to convert a PromptGroupDoc and its ID to a PromptPreview object
	private _toPromptPreview(promptGroupDocId: string, groupDocData: PromptGroupDoc): PromptPreview {
		return {
			id: promptGroupDocId,
			userId: groupDocData.userId,
			parentId: groupDocData.parentId === null ? undefined : groupDocData.parentId,
			revisionId: groupDocData.latestRevisionId,
			name: groupDocData.name,
			appId: groupDocData.appId === null ? undefined : groupDocData.appId,
			tags: groupDocData.tags,
			settings: groupDocData.options,
		};
	}

	async getPrompt(promptId: string, userId: string): Promise<Prompt | null> {
		const promptGroupRef = this.db.collection(PROMPTS_COLLECTION).doc(promptId);
		const promptGroupSnap = await promptGroupRef.get();

		if (!promptGroupSnap.exists) {
			return null;
		}

		const groupDocData = promptGroupSnap.data() as PromptGroupDoc;
		if (groupDocData.userId !== userId) {
			logger.warn(`Unauthorized access attempt for prompt ${promptId} by user ${userId}`);
			return null; // Unauthorized
		}

		const revisionRef = promptGroupRef.collection(REVISIONS_SUBCOLLECTION).doc(String(groupDocData.latestRevisionId));
		const revisionSnap = await revisionRef.get();

		if (!revisionSnap.exists) {
			logger.error(`Latest revision ${groupDocData.latestRevisionId} for prompt ${promptId} not found.`);
			return null; // Data inconsistency
		}

		const revisionDocData = revisionSnap.data() as RevisionDoc;
		return this._toPrompt(promptId, revisionDocData);
	}

	async getPromptVersion(promptId: string, revisionId: number, userId: string): Promise<Prompt | null> {
		const promptGroupRef = this.db.collection(PROMPTS_COLLECTION).doc(promptId);
		const promptGroupSnap = await promptGroupRef.get();

		if (!promptGroupSnap.exists) {
			return null;
		}

		const groupDocData = promptGroupSnap.data() as PromptGroupDoc;
		if (groupDocData.userId !== userId) {
			logger.warn(`Unauthorized access attempt for prompt ${promptId} version ${revisionId} by user ${userId}`);
			return null; // Unauthorized
		}

		const revisionRef = promptGroupRef.collection(REVISIONS_SUBCOLLECTION).doc(String(revisionId));
		const revisionSnap = await revisionRef.get();

		if (!revisionSnap.exists) {
			return null; // Revision not found
		}

		const revisionDocData = revisionSnap.data() as RevisionDoc;
		return this._toPrompt(promptId, revisionDocData);
	}

	async listPromptsForUser(userId: string): Promise<PromptPreview[]> {
		const querySnapshot = await this.db.collection(PROMPTS_COLLECTION).where('userId', '==', userId).orderBy('updatedAt', 'desc').get();

		const previews: PromptPreview[] = [];
		querySnapshot.forEach((doc) => {
			previews.push(this._toPromptPreview(doc.id, doc.data() as PromptGroupDoc));
		});

		return previews;
	}

	async createPrompt(promptData: Omit<Prompt, 'id' | 'revisionId' | 'userId'>, userId: string): Promise<Prompt> {
		const newPromptId = this.db.collection(PROMPTS_COLLECTION).doc().id;
		const firstRevisionId = 1;
		const serverTimestamp = FieldValue.serverTimestamp() as Timestamp; // Firestore will convert this

		const promptGroupDocData: PromptGroupDoc = {
			userId,
			latestRevisionId: firstRevisionId,
			name: promptData.name,
			appId: promptData.appId ?? null,
			tags: promptData.tags,
			parentId: promptData.parentId ?? null,
			options: promptData.settings,
			createdAt: serverTimestamp,
			updatedAt: serverTimestamp,
		};

		const revisionDocData: RevisionDoc = {
			messages: promptData.messages,
			options: promptData.settings,
			name: promptData.name,
			appId: promptData.appId ?? null,
			tags: promptData.tags,
			parentId: promptData.parentId ?? null,
			promptId: newPromptId,
			revisionId: firstRevisionId,
			userId: userId,
			createdAt: serverTimestamp,
		};

		const batch: WriteBatch = this.db.batch();
		const promptGroupRef = this.db.collection(PROMPTS_COLLECTION).doc(newPromptId);
		const revisionRef = promptGroupRef.collection(REVISIONS_SUBCOLLECTION).doc(String(firstRevisionId));

		batch.set(promptGroupRef, promptGroupDocData);
		batch.set(revisionRef, revisionDocData);

		await batch.commit();

		// For the returned Prompt, we need actual Timestamp values if the caller expects them.
		// However, _toPrompt doesn't map createdAt/updatedAt from RevisionDoc to Prompt.
		// The RevisionDoc used here has serverTimestamp for createdAt, which is a sentinel.
		// If a fully resolved Prompt (with actual timestamps) is needed immediately, a re-fetch might be considered,
		// but for now, we'll return based on the data we have, acknowledging serverTimestamp is a placeholder.
		// The current _toPrompt doesn't use createdAt from RevisionDoc anyway.
		return this._toPrompt(newPromptId, revisionDocData);
	}

	async updatePrompt(promptId: string, updates: Partial<Omit<Prompt, 'id' | 'userId' | 'revisionId'>>, userId: string, newVersion: boolean): Promise<Prompt> {
		const promptGroupRef = this.db.collection(PROMPTS_COLLECTION).doc(promptId);

		return this.db.runTransaction(async (transaction) => {
			const promptGroupSnap = await transaction.get(promptGroupRef);
			if (!promptGroupSnap.exists) {
				throw new Error('Prompt not found');
			}

			const groupDocData = promptGroupSnap.data() as PromptGroupDoc;
			if (groupDocData.userId !== userId) {
				throw new Error('User not authorized');
			}

			const currentLatestRevisionId = groupDocData.latestRevisionId;
			let updatedRevisionDocData: RevisionDoc;
			const serverTimestamp = FieldValue.serverTimestamp() as Timestamp;

			if (newVersion) {
				const newRevisionId = currentLatestRevisionId + 1;
				const latestRevisionRef = promptGroupRef.collection(REVISIONS_SUBCOLLECTION).doc(String(currentLatestRevisionId));
				const latestRevisionSnap = await transaction.get(latestRevisionRef);

				if (!latestRevisionSnap.exists) {
					// This case should ideally not happen if data is consistent
					logger.error(`Data inconsistency: Latest revision ${currentLatestRevisionId} for prompt ${promptId} missing during update.`);
					throw new Error('Latest revision data missing');
				}
				const baseRevisionData = latestRevisionSnap.data() as RevisionDoc;

				updatedRevisionDocData = {
					...baseRevisionData, // Start with a copy of the old revision
					promptId, // Ensure promptId is set (though it's same as baseRevisionData.promptId)
					userId, // Ensure userId is set (though it's same as baseRevisionData.userId)
					revisionId: newRevisionId,
					createdAt: serverTimestamp, // New revision gets a new creation timestamp
					// Apply updates, falling back to base data if not provided in 'updates'
					name: updates.name ?? baseRevisionData.name,
					// For optional fields that can be explicitly nulled:
					// If updates.appId is undefined, it means "don't change appId", so use baseRevisionData.appId.
					// If updates.appId is provided (even if null), use it (mapping undefined within updates to null for DB).
					appId: updates.appId === undefined ? baseRevisionData.appId : (updates.appId ?? null),
					parentId: updates.parentId === undefined ? baseRevisionData.parentId : (updates.parentId ?? null),
					tags: updates.tags ?? baseRevisionData.tags,
					messages: updates.messages ?? baseRevisionData.messages,
					options: updates.settings ?? baseRevisionData.options,
				};

				const newRevisionRef = promptGroupRef.collection(REVISIONS_SUBCOLLECTION).doc(String(newRevisionId));
				transaction.set(newRevisionRef, updatedRevisionDocData);
				transaction.update(promptGroupRef, {
					latestRevisionId: newRevisionId,
					updatedAt: serverTimestamp,
					// Denormalize fields from the new latest revision
					name: updatedRevisionDocData.name,
					appId: updatedRevisionDocData.appId,
					tags: updatedRevisionDocData.tags,
					parentId: updatedRevisionDocData.parentId,
					options: updatedRevisionDocData.options,
				});
			} else {
				// Update existing latest revision
				const targetRevisionId = currentLatestRevisionId;
				const targetRevisionRef = promptGroupRef.collection(REVISIONS_SUBCOLLECTION).doc(String(targetRevisionId));
				const targetRevisionSnap = await transaction.get(targetRevisionRef);

				if (!targetRevisionSnap.exists) {
					logger.error(`Data inconsistency: Target revision ${targetRevisionId} for prompt ${promptId} missing during in-place update.`);
					throw new Error('Target revision data missing');
				}
				const baseRevisionData = targetRevisionSnap.data() as RevisionDoc;

				updatedRevisionDocData = {
					...baseRevisionData, // Start with the existing revision data
					// promptId, userId, revisionId remain the same as baseRevisionData
					// createdAt remains the same as baseRevisionData.createdAt (original creation time of this revision)
					// Apply updates
					name: updates.name ?? baseRevisionData.name,
					appId: updates.appId === undefined ? baseRevisionData.appId : (updates.appId ?? null),
					parentId: updates.parentId === undefined ? baseRevisionData.parentId : (updates.parentId ?? null),
					tags: updates.tags ?? baseRevisionData.tags,
					messages: updates.messages ?? baseRevisionData.messages,
					options: updates.settings ?? baseRevisionData.options,
				};
				// Ensure promptId, userId, revisionId are correctly maintained from baseRevisionData
				updatedRevisionDocData.promptId = promptId; // or baseRevisionData.promptId
				updatedRevisionDocData.userId = userId; // or baseRevisionData.userId
				updatedRevisionDocData.revisionId = targetRevisionId; // or baseRevisionData.revisionId

				transaction.set(targetRevisionRef, updatedRevisionDocData); // Overwrite the revision document with merged data
				transaction.update(promptGroupRef, {
					updatedAt: serverTimestamp,
					// Denormalize fields from the updated latest revision
					name: updatedRevisionDocData.name,
					appId: updatedRevisionDocData.appId,
					tags: updatedRevisionDocData.tags,
					parentId: updatedRevisionDocData.parentId,
					options: updatedRevisionDocData.options,
				});
			}
			return this._toPrompt(promptId, updatedRevisionDocData);
		});
	}

	async deletePrompt(promptId: string, userId: string): Promise<void> {
		const promptGroupRef = this.db.collection(PROMPTS_COLLECTION).doc(promptId);
		const promptGroupSnap = await promptGroupRef.get();

		if (!promptGroupSnap.exists) {
			// If prompt doesn't exist, consider it successfully "deleted" or throw specific error
			// throw new Error('Prompt not found');
			logger.warn(`Attempted to delete non-existent prompt ${promptId}`);
			return; // Or throw error as per desired behavior
		}

		const groupDocData = promptGroupSnap.data() as PromptGroupDoc;
		if (groupDocData.userId !== userId) {
			throw new Error('User not authorized');
		}

		const revisionsCollectionRef = promptGroupRef.collection(REVISIONS_SUBCOLLECTION);
		const revisionsSnapshot = await revisionsCollectionRef.get(); // Consider limiting if many revisions, though typically not an issue

		const batch: WriteBatch = this.db.batch();

		revisionsSnapshot.docs.forEach((doc) => {
			batch.delete(doc.ref);
		});

		batch.delete(promptGroupRef);

		await batch.commit();
		logger.info(`Prompt ${promptId} and its revisions deleted by user ${userId}`);
	}
}
