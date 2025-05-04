import { randomUUID } from 'node:crypto';
import { FieldValue, type Firestore } from '@google-cloud/firestore';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
// Removed currentUser import
import type { VibeRepository } from '#vibe/vibeRepository'; // Import VibeRepository
// Remove VibeService import
import type {
	// Remove CommitChangesData, CreateVibeSessionData
	// Remove DesignAnswer, FileSystemNode, UpdateCodeReviewData, UpdateDesignInstructionsData
	UpdateVibeSessionData,
	VibePreset,
	// Remove SelectedFile as VibeSelectedFile
	VibeSession,
	// Remove VibeStatus
} from '#vibe/vibeTypes';
import { firestoreDb } from './firestore';

// Remove mockAgentRunner object

const VIBE_SESSIONS_COLLECTION = 'vibeSessions';
const VIBE_PRESETS_COLLECTION = 'vibePresets';

/**
 * Firestore implementation for managing VibeSession and VibePreset data persistence.
 */
export class FirestoreVibeRepository implements VibeRepository {
	// Implement VibeRepository
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
		if (!session.id || !session.userId) {
			throw new Error('Session ID and User ID must be provided');
		}
		const { id: sessionId, userId } = session;

		// Prepare data with server timestamps if not already present
		const sessionToSave: VibeSession = {
			...session,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			lastAgentActivity: Date.now(),
		};

		try {
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Use create() to prevent overwriting existing documents with the same ID
			await docRef.create(sessionToSave);
			logger.info({ sessionId, userId }, 'VibeSession created successfully in user subcollection.');
			return sessionId;
		} catch (error: any) {
			// Firestore error code 6 means ALREADY_EXISTS
			if (error?.code === 6) {
				logger.error({ sessionId, userId }, 'Attempted to create VibeSession with existing ID.');
				throw new Error(`VibeSession with ID ${sessionId} already exists.`);
			}
			logger.error(error, `Error creating VibeSession ${sessionId} for user ${userId}`);
			throw error; // Re-throw other errors
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
		// Authorization check removed - assumed to happen upstream.
		// Repository trusts the provided userId to define the scope.
		try {
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			const docSnap = await docRef.get();

			if (!docSnap.exists) {
				logger.warn({ userId, sessionId }, 'VibeSession not found in user subcollection');
				return null;
			}

			// Convert Firestore Timestamp to number (milliseconds since epoch) for consistency
			const data = docSnap.data();
			const session: VibeSession = {
				...(data as Omit<VibeSession, 'createdAt' | 'updatedAt' | 'lastAgentActivity'>), // Cast basic structure
				// Explicitly convert timestamps
				createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt,
				updatedAt: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : data.updatedAt,
				lastAgentActivity: data.lastAgentActivity?.toMillis ? data.lastAgentActivity.toMillis() : data.lastAgentActivity,
			};

			logger.info({ userId, sessionId }, 'VibeSession retrieved successfully');
			return session;
		} catch (error) {
			logger.error(error, `Error retrieving VibeSession ${sessionId} for user ${userId}`);
			throw error; // Re-throw after logging
		}
	}

	/**
	 * Lists all VibeSessions for the current user, ordered by creation date descending.
	 * @param userId The ID of the user whose sessions to list.
	 * @returns An array of VibeSessions.
	 */
	@span()
	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		// Authorization check removed - assumed to happen upstream.
		// Repository trusts the provided userId to define the scope.
		try {
			const querySnapshot = await this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).orderBy('createdAt', 'desc').get();

			const sessions: VibeSession[] = [];
			querySnapshot.forEach((doc) => {
				const data = doc.data();
				// Convert Firestore Timestamps to numbers
				sessions.push({
					...(data as Omit<VibeSession, 'createdAt' | 'updatedAt' | 'lastAgentActivity'>),
					createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt,
					updatedAt: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : data.updatedAt,
					lastAgentActivity: data.lastAgentActivity?.toMillis ? data.lastAgentActivity.toMillis() : data.lastAgentActivity,
				});
			});

			logger.info({ userId, count: sessions.length }, 'Listed VibeSessions successfully');
			return sessions;
		} catch (error) {
			logger.error(error, `Error listing VibeSessions for user ${userId}`);
			throw error; // Re-throw after logging
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
		// Authorization check removed - assumed to happen upstream.
		// Repository trusts the provided userId to define the scope.

		// Prepare update data, ensuring updatedAt is set to server timestamp
		const updateData = {
			...updates,
			updatedAt: FieldValue.serverTimestamp(),
		};

		try {
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Use update which fails if the document doesn't exist
			await docRef.update(updateData);
			logger.info({ sessionId, userId }, 'VibeSession updated successfully in user subcollection');
		} catch (error: any) {
			// Firestore error code 5 means NOT_FOUND
			if (error?.code === 5) {
				logger.warn({ userId, sessionId }, 'Attempted to update non-existent VibeSession');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}
			logger.error(error, `Error updating VibeSession ${sessionId} for user ${userId}`);
			throw error; // Re-throw other errors
		}
	}

	/**
	 * Deletes a VibeSession by its ID for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to delete.
	 */
	@span()
	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		// Authorization check removed - assumed to happen upstream.
		// Repository trusts the provided userId to define the scope.
		try {
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Firestore delete is idempotent (doesn't error if doc doesn't exist)
			await docRef.delete();
			logger.info({ sessionId, userId }, 'VibeSession deleted successfully (or did not exist) from user subcollection');
		} catch (error) {
			logger.error(error, `Error deleting VibeSession ${sessionId} for user ${userId}`);
			throw error; // Re-throw after logging
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
		if (!preset.id || !preset.userId || !preset.name) {
			throw new Error('Preset ID, User ID, and Name must be provided');
		}
		const { id: presetId, userId, name } = preset;
		// Authorization check removed - assumed to happen upstream.
		// Repository trusts the userId within the preset object for path construction.

		// Prepare data with server timestamps if not already present
		const presetToSave = {
			...preset,
			createdAt: preset.createdAt ?? FieldValue.serverTimestamp(),
			updatedAt: preset.updatedAt ?? FieldValue.serverTimestamp(),
		};

		try {
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_PRESETS_COLLECTION).doc(presetId);
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
			throw error; // Re-throw other errors
		}
	}

	/**
	 * Lists all VibePresets for the specified user from their subcollection.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of VibePreset objects.
	 */
	@span()
	async listVibePresets(userId: string): Promise<VibePreset[]> {
		// Authorization check removed - assumed to happen upstream.
		// Repository trusts the provided userId to define the scope.
		try {
			const querySnapshot = await this.db.collection('users').doc(userId).collection(VIBE_PRESETS_COLLECTION).orderBy('createdAt', 'desc').get();

			const presets: VibePreset[] = [];
			querySnapshot.forEach((doc) => {
				const data = doc.data();
				// Convert Firestore Timestamps to numbers
				presets.push({
					...(data as Omit<VibePreset, 'createdAt' | 'updatedAt'>),
					createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt,
					updatedAt: data.updatedAt?.toMillis ? data.updatedAt.toMillis() : data.updatedAt,
				});
			});

			logger.info({ userId, count: presets.length }, 'Listed VibePresets successfully for user');
			return presets;
		} catch (error) {
			logger.error(error, `Error listing VibePresets for user ${userId}`);
			throw error; // Re-throw after logging
		}
	}

	/**
	 * Deletes a specific VibePreset for the user from their subcollection.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the VibePreset to delete.
	 */
	@span()
	async deleteVibePreset(userId: string, presetId: string): Promise<void> {
		// Authorization check removed - assumed to happen upstream.
		// Repository trusts the provided userId to define the scope.
		try {
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_PRESETS_COLLECTION).doc(presetId);
			// Firestore delete is idempotent
			await docRef.delete();
			logger.info({ presetId, userId }, 'VibePreset deleted successfully (or did not exist) from user subcollection');
		} catch (error) {
			logger.error(error, `Error deleting VibePreset ${presetId} for user ${userId}`);
			throw error; // Re-throw after logging
		}
	}

	// --- REMOVED Workflow Actions ---
	// All methods related to workflow orchestration (updateSelectionWithPrompt, generateDetailedDesign,
	// updateDesignWithPrompt, updateDesignWithInstructions, executeDesign, startCoding,
	// updateCodeWithComments, commitChanges, getBranchList, getFileSystemTree, getFileContent,
	// applyCiCdFix) have been removed from this repository implementation.
	// They belong in the VibeService implementation.
}
