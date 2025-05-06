import type { Firestore } from '@google-cloud/firestore';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import type { VibeRepository } from '#vibe/vibeRepository';

import { USERS_COLLECTION } from '#firestore/firestoreUserService';
import type { UpdateVibeSessionData, VibePreset, VibeSession } from '#vibe/vibeTypes';
import { firestoreDb } from './firestore';

const VIBE_SESSIONS_COLLECTION = 'vibeSessions';
const VIBE_PRESETS_COLLECTION = 'vibePresets';

/**
 * Firestore implementation for managing VibeSession and VibePreset data persistence.
 */
export class FirestoreVibeRepository implements VibeRepository {
	private db: Firestore;

	constructor() {
		this.db = firestoreDb();
	}

	/**
	 * Saves a new VibeSession to Firestore.
	 * @param session The complete VibeSession object to save.
	 * @returns The ID of the saved session.
	 */
	@span()
	async createVibeSession(session: VibeSession): Promise<string> {
		if (!session.id || !session.userId) throw new Error('Session ID and User ID must be provided');

		const { id: sessionId, userId } = session;

		const sessionToSave: VibeSession = {
			...session,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			lastAgentActivity: Date.now(),
		};

		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Use create() to prevent overwriting existing documents with the same ID
			await docRef.create(sessionToSave);
			logger.info({ sessionId, userId }, 'VibeSession created');
			return sessionId;
		} catch (error: any) {
			// Firestore error code 6 means ALREADY_EXISTS
			if (error?.code === 6) {
				logger.error({ sessionId, userId }, 'Attempted to create VibeSession with existing ID in user subcollection.');
				throw new Error(`VibeSession with ID ${sessionId} already exists for user ${userId}.`);
			}
			logger.error(error, `Error creating VibeSession ${sessionId} for user ${userId} in subcollection`);
			throw error;
		}
	}

	/**
	 * Retrieves a specific VibeSession by its ID for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to retrieve.
	 * @returns The VibeSession if found and authorized, otherwise null.
	 */
	@span()
	async getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			const docSnap = await docRef.get();

			if (!docSnap.exists) {
				logger.warn({ userId, sessionId }, 'VibeSession not found for user');
				return null;
			}

			const data = docSnap.data();
			// Ownership is implicitly checked by the path, but double-check just in case
			if (data?.userId !== userId) {
				logger.error({ userId, sessionId, ownerId: data?.userId }, 'Data inconsistency: VibeSession userId mismatch in user subcollection');
				// This case should ideally not happen if data is consistent
				return null; // Or throw an error
			}

			return {
				...(data as VibeSession),
			};
		} catch (error) {
			logger.error(error, `Error retrieving VibeSession ${sessionId} for user ${userId}`);
			throw error;
		}
	}

	/**
	 * Lists all VibeSessions for the current user, ordered by creation date descending.
	 * @param userId The ID of the user whose sessions to list.
	 * @returns An array of VibeSessions.
	 */
	@span()
	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		try {
			const querySnapshot = await this.db.collection(USERS_COLLECTION).doc(userId).collection(VIBE_SESSIONS_COLLECTION).orderBy('createdAt', 'desc').get();

			const sessions: VibeSession[] = [];
			querySnapshot.forEach((doc) => {
				const data = doc.data();
				sessions.push(data as VibeSession);
			});

			logger.info({ userId, count: sessions.length }, 'Listed VibeSessions successfully from user subcollection');
			return sessions;
		} catch (error) {
			logger.error(error, `Error listing VibeSessions for user ${userId} from subcollection`);
			throw error;
		}
	}

	/**
	 * Updates specified fields of a VibeSession for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to update.
	 * @param updates An object containing the fields to update.
	 */
	@span()
	async updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		const updateData = {
			...updates,
			updatedAt: Date.now(),
		};

		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Use update which fails if the document doesn't exist (implicitly checks ownership via path)
			await docRef.update(updateData);
			logger.info({ sessionId, userId }, 'VibeSession updated successfully in user subcollection');
		} catch (error: any) {
			// Firestore error code 5 means NOT_FOUND
			if (error?.code === 5) {
				logger.warn({ userId, sessionId }, 'Attempted to update non-existent VibeSession for user');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}
			logger.error(error, `Error updating VibeSession ${sessionId} for user ${userId}`);
			throw error;
		}
	}

	/**
	 * Deletes a VibeSession by its ID for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to delete.
	 */
	@span()
	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Firestore delete is idempotent (doesn't error if doc doesn't exist)
			// Ownership is implicitly checked by the path.
			await docRef.delete();
			logger.info({ sessionId, userId }, 'VibeSession deleted successfully (or did not exist) from user subcollection');
		} catch (error) {
			logger.error(error, `Error deleting VibeSession ${sessionId} for user ${userId}`);
			throw error;
		}
	}

	// --- Preset Management ---

	/**
	 * Saves a new VibePreset to Firestore.
	 * @param preset The complete VibePreset object to save.
	 * @returns The ID of the saved preset.
	 */
	@span()
	async saveVibePreset(preset: VibePreset): Promise<string> {
		if (!preset.id || !preset.userId || !preset.name) throw new Error('Preset ID, User ID, and Name must be provided');
		const { id: presetId, userId, name } = preset;

		const presetToSave = {
			...preset,
			createdAt: preset.createdAt ?? Date.now(),
			updatedAt: Date.now(),
		};

		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(VIBE_PRESETS_COLLECTION).doc(presetId);
			// Use create() to prevent overwriting
			await docRef.create(presetToSave);
			logger.info({ presetId, userId, presetName: name }, 'VibePreset saved successfully in user subcollection');
			return presetId;
		} catch (error: any) {
			// Firestore error code 6 means ALREADY_EXISTS
			if (error?.code === 6) {
				logger.error({ presetId, userId }, 'Attempted to create VibePreset with existing ID.');
				throw new Error(`VibePreset with ID ${presetId} already exists.`);
			}
			logger.error(error, `Error saving VibePreset '${name}' for user ${userId}`);
			throw error;
		}
	}

	/**
	 * Lists all VibePresets for the specified user from their subcollection.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of VibePreset objects.
	 */
	@span()
	async listVibePresets(userId: string): Promise<VibePreset[]> {
		try {
			const querySnapshot = await this.db.collection(USERS_COLLECTION).doc(userId).collection(VIBE_PRESETS_COLLECTION).orderBy('createdAt', 'desc').get();

			const presets: VibePreset[] = [];
			querySnapshot.forEach((doc) => {
				presets.push(doc.data() as VibePreset);
			});

			logger.info({ userId, count: presets.length }, 'Listed VibePresets successfully for user');
			return presets;
		} catch (error) {
			logger.error(error, `Error listing VibePresets for user ${userId}`);
			throw error;
		}
	}

	/**
	 * Deletes a specific VibePreset for the user from their subcollection.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the VibePreset to delete.
	 */
	@span()
	async deleteVibePreset(userId: string, presetId: string): Promise<void> {
		try {
			const docRef = this.db.collection(USERS_COLLECTION).doc(userId).collection(VIBE_PRESETS_COLLECTION).doc(presetId);
			// Firestore delete is idempotent
			await docRef.delete();
			logger.info({ presetId, userId }, 'VibePreset deleted successfully (or did not exist) from user subcollection');
		} catch (error) {
			logger.error(error, `Error deleting VibePreset ${presetId} for user ${userId}`);
			throw error;
		}
	}
}
