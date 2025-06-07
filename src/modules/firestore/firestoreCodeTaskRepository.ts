import type { Firestore } from '@google-cloud/firestore';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { CodeTaskRepository } from '../../codeTask/codeTaskRepository';

import { USERS_COLLECTION } from '#firestore/firestoreUserService';
import type { CodeTask, CodeTaskPreset, UpdateCodeTaskData } from '#shared/codeTask/codeTask.model';
import { firestoreDb } from './firestore';

const CODE_TASKS_COLLECTION = 'codeTasks';
const CODE_TASK_PRESETS_COLLECTION = 'codeTaskPresets';

/**
 * Firestore implementation for managing CodeTask and CodeTaskPreset data persistence.
 */
export class FirestoreCodeTaskRepository implements CodeTaskRepository {
	private db: Firestore;

	constructor() {
		this.db = firestoreDb();
	}

	/**
	 * Saves a new CodeTask to Firestore.
	 * @param codeTask The complete CodeTask object to save.
	 * @returns The ID of the saved codeTask.
	 */
	@span()
	async createCodeTask(codeTask: CodeTask): Promise<string> {
		if (!codeTask.id || !codeTask.userId) throw new Error('CodeTask ID and User ID must be provided');

		const { id: codeTaskId, userId } = codeTask;

		const codeTaskToSave: CodeTask = {
			...codeTask,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			lastAgentActivity: Date.now(),
		};

		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(CODE_TASKS_COLLECTION).doc(codeTaskId);
			// Use create() to prevent overwriting existing documents with the same ID
			await docRef.create(codeTaskToSave);
			logger.info({ codeTaskId, userId }, 'CodeTask created');
			return codeTaskId;
		} catch (error: any) {
			// Firestore error code 6 means ALREADY_EXISTS
			if (error?.code === 6) {
				logger.error({ codeTaskId, userId }, 'Attempted to create CodeTask with existing ID in user subcollection.');
				throw new Error(`CodeTask with ID ${codeTaskId} already exists for user ${userId}.`);
			}
			logger.error(error, `Error creating CodeTask ${codeTaskId} for user ${userId} in subcollection`);
			throw error;
		}
	}

	/**
	 * Retrieves a specific CodeTask by its ID for a given user.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to retrieve.
	 * @returns The CodeTask if found and authorized, otherwise null.
	 */
	@span()
	async getCodeTask(userId: string, codeTaskId: string): Promise<CodeTask | null> {
		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(CODE_TASKS_COLLECTION).doc(codeTaskId);
			const docSnap = await docRef.get();

			if (!docSnap.exists) {
				logger.warn({ userId, codeTaskId }, 'CodeTask not found for user');
				return null;
			}

			const data = docSnap.data();
			// Ownership is implicitly checked by the path, but double-check just in case
			if (data?.userId !== userId) {
				logger.error({ userId, codeTaskId, ownerId: data?.userId }, 'Data inconsistency: CodeTask userId mismatch in user subcollection');
				// This case should ideally not happen if data is consistent
				return null; // Or throw an error
			}

			return {
				...(data as CodeTask),
			};
		} catch (error) {
			logger.error(error, `Error retrieving CodeTask ${codeTaskId} for user ${userId}`);
			throw error;
		}
	}

	/**
	 * Lists all CodeTasks for the current user, ordered by creation date descending.
	 * @param userId The ID of the user whose codeTasks to list.
	 * @returns An array of CodeTasks.
	 */
	@span()
	async listCodeTasks(userId: string): Promise<CodeTask[]> {
		try {
			const querySnapshot = await this.db.collection(USERS_COLLECTION).doc(userId).collection(CODE_TASKS_COLLECTION).orderBy('createdAt', 'desc').get();

			const codeTasks: CodeTask[] = [];
			querySnapshot.forEach((doc) => {
				const data = doc.data();
				codeTasks.push(data as CodeTask);
			});

			logger.info({ userId, count: codeTasks.length }, 'Listed CodeTasks successfully from user subcollection');
			return codeTasks;
		} catch (error) {
			logger.error(error, `Error listing CodeTasks for user ${userId} from subcollection`);
			throw error;
		}
	}

	/**
	 * Updates specified fields of a CodeTask for a given user.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to update.
	 * @param updates An object containing the fields to update.
	 */
	@span()
	async updateCodeTask(userId: string, codeTaskId: string, updates: UpdateCodeTaskData): Promise<void> {
		const updateData = {
			...updates,
			updatedAt: Date.now(),
		};

		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(CODE_TASKS_COLLECTION).doc(codeTaskId);
			// Use update which fails if the document doesn't exist (implicitly checks ownership via path)
			await docRef.update(updateData);
			logger.info({ codeTaskId, userId }, 'CodeTask updated successfully in user subcollection');
		} catch (error: any) {
			// Firestore error code 5 means NOT_FOUND
			if (error?.code === 5) {
				logger.warn({ userId, codeTaskId }, 'Attempted to update non-existent CodeTask for user');
				throw new Error(`CodeTask ${codeTaskId} not found for user ${userId}.`);
			}
			logger.error(error, `Error updating CodeTask ${codeTaskId} for user ${userId}`);
			throw error;
		}
	}

	/**
	 * Deletes a CodeTask by its ID for a given user.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to delete.
	 */
	@span()
	async deleteCodeTask(userId: string, codeTaskId: string): Promise<void> {
		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(CODE_TASKS_COLLECTION).doc(codeTaskId);
			// Firestore delete is idempotent (doesn't error if doc doesn't exist)
			// Ownership is implicitly checked by the path.
			await docRef.delete();
			logger.info({ codeTaskId, userId }, 'CodeTask deleted successfully (or did not exist) from user subcollection');
		} catch (error) {
			logger.error(error, `Error deleting CodeTask ${codeTaskId} for user ${userId}`);
			throw error;
		}
	}

	// --- Preset Management ---

	/**
	 * Saves a new CodeTaskPreset to Firestore.
	 * @param preset The complete CodeTaskPreset object to save.
	 * @returns The ID of the saved preset.
	 */
	@span()
	async saveCodeTaskPreset(preset: CodeTaskPreset): Promise<string> {
		if (!preset.id || !preset.userId || !preset.name) throw new Error('Preset ID, User ID, and Name must be provided');
		const { id: presetId, userId, name } = preset;

		const presetToSave = {
			...preset,
			createdAt: preset.createdAt ?? Date.now(),
			updatedAt: Date.now(),
		};

		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(CODE_TASK_PRESETS_COLLECTION).doc(presetId);
			// Use create() to prevent overwriting
			await docRef.create(presetToSave);
			logger.info({ presetId, userId, presetName: name }, 'CodeTaskPreset saved successfully in user subcollection');
			return presetId;
		} catch (error: any) {
			// Firestore error code 6 means ALREADY_EXISTS
			if (error?.code === 6) {
				logger.error({ presetId, userId }, 'Attempted to create CodeTaskPreset with existing ID.');
				throw new Error(`CodeTaskPreset with ID ${presetId} already exists.`);
			}
			logger.error(error, `Error saving CodeTaskPreset '${name}' for user ${userId}`);
			throw error;
		}
	}

	/**
	 * Lists all CodeTaskPresets for the specified user from their subcollection.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of CodeTaskPreset objects.
	 */
	@span()
	async listCodeTaskPresets(userId: string): Promise<CodeTaskPreset[]> {
		try {
			const querySnapshot = await this.db.collection(USERS_COLLECTION).doc(userId).collection(CODE_TASK_PRESETS_COLLECTION).orderBy('createdAt', 'desc').get();

			const presets: CodeTaskPreset[] = [];
			querySnapshot.forEach((doc) => {
				const data = doc.data() as CodeTaskPreset;
				// Extra safety-check: only include docs that really belong to this user
				if (data.userId === userId) {
					presets.push(data);
				} else {
					logger.warn(
						{ requestedUserId: userId, presetId: data.id, ownerId: data.userId },
						'Data inconsistency: CodeTaskPreset userId mismatch – ignored',
					);
				}
			});

			// Ensure deterministic order (Firestore already orders, but keep it bullet-proof)
			presets.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

			logger.info({ userId, count: presets.length }, 'Listed CodeTaskPresets successfully for user');
			return presets;
		} catch (error) {
			logger.error(error, `Error listing CodeTaskPresets for user ${userId}`);
			throw error;
		}
	}

	/**
	 * Deletes a specific CodeTaskPreset for the user from their subcollection.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the CodeTaskPreset to delete.
	 */
	@span()
	async deleteCodeTaskPreset(userId: string, presetId: string): Promise<void> {
		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(CODE_TASK_PRESETS_COLLECTION).doc(presetId);
			// Firestore delete is idempotent
			await docRef.delete();
			logger.info({ presetId, userId }, 'CodeTaskPreset deleted successfully (or did not exist) from user subcollection');
		} catch (error) {
			logger.error(error, `Error deleting CodeTaskPreset ${presetId} for user ${userId}`);
			throw error;
		}
	}
}
