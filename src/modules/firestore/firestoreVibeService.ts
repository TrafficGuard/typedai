import { randomUUID } from 'node:crypto';
import { FieldValue, type Firestore } from '@google-cloud/firestore';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { currentUser } from '#user/userService/userContext';
import type { VibeService, VibeSession, CreateVibeSessionData, UpdateVibeSessionData } from '#vibe/vibeTypes'; // Import the interface and types
import { firestoreDb } from './firestore';

const VIBE_SESSIONS_COLLECTION = 'vibeSessions';

/**
 * Firestore implementation for managing VibeSession data.
 */
export class FirestoreVibeService implements VibeService { // Implement the VibeService interface
	private db: Firestore;

	constructor() {
		this.db = firestoreDb();
	}

	/**
	 * Creates a new VibeSession in Firestore.
	 * @param userId The ID of the user creating the session.
	 * @param sessionData Data for the new session.
	 * @returns The newly created VibeSession.
	 */
	@span()
	async createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession> {
		// const now = Date.now(); // Remove this line
		const newSessionData = {
			// Use a temporary object to satisfy type checking before adding timestamps
			...sessionData,
			id: randomUUID(),
			userId: userId,
			status: 'initializing' as const, // Initial status updated
			// Timestamps will be added below
		};

		const newSessionWithTimestamps = {
			...newSessionData,
			createdAt: FieldValue.serverTimestamp(), // Use server timestamp
			updatedAt: FieldValue.serverTimestamp(), // Use server timestamp
		};

		try {
			// Use the user-specific path
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(newSessionData.id);
			// Firestore types require the data passed to set() to match the structure including timestamps
			await docRef.set(newSessionWithTimestamps);
			logger.info({ sessionId: newSessionData.id, userId }, 'VibeSession created successfully in user subcollection');

			// Note: Firestore returns the write result, not the document with resolved timestamps immediately.
			// To return the full VibeSession with resolved timestamps, a subsequent get() would be needed.
			// However, the current implementation returns the object *before* timestamps are resolved by the server.
			// Let's return the object *as sent* to Firestore, acknowledging the timestamps are placeholders.
			// The caller should be aware of this or we'd need to refetch.
			// For simplicity matching existing pattern, return the object with FieldValue placeholders.
			return newSessionWithTimestamps as VibeSession; // Cast needed as FieldValue != number/Date
		} catch (error) {
			logger.error(error, `Error creating VibeSession for user ${userId}`);
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
		// Security check: Ensure the requesting user matches the userId in the path
		if (userId !== currentUser().id) {
			logger.warn({ requestedUserId: userId, currentUserId: currentUser().id, sessionId }, 'Attempt to get VibeSession for another user');
			// Returning null is less revealing than throwing an error.
			return null;
		}

		try {
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			const docSnap = await docRef.get();

			if (!docSnap.exists) {
				logger.warn({ userId, sessionId }, 'VibeSession not found in user subcollection');
				return null;
			}

			// The path already scopes to the user, so the internal userId check is redundant here.
			// The check against currentUser().id at the beginning handles authorization.
			const session = docSnap.data() as VibeSession;

			return session;
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
		// Ensure the operation is performed for the currently authenticated user
		if (userId !== currentUser().id) {
			logger.warn({ requestedUserId: userId, currentUserId: currentUser().id }, 'Attempt to list VibeSessions for another user');
			throw new Error('Cannot list sessions for another user.');
		}

		try {
			// Query the user-specific subcollection directly
			const querySnapshot = await this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).orderBy('createdAt', 'desc').get();

			const sessions: VibeSession[] = [];
			querySnapshot.forEach((doc) => {
				sessions.push(doc.data() as VibeSession);
			});

			logger.info({ userId, count: sessions.length }, 'Listed VibeSessions successfully');
			return sessions;
		} catch (error) {
			logger.error(error, `Error listing VibeSessions for user ${userId}`);
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
		// Security check: Ensure the requesting user matches the userId in the path
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to update VibeSession for another user',
			);
			throw new Error('Not authorized to update this Vibe session');
		}

		// The type UpdateVibeSessionData already excludes id, userId, and createdAt.
		// We just need to add the server timestamp for updatedAt.
		const updateData = {
			...updates,
			updatedAt: FieldValue.serverTimestamp(), // Use server timestamp
		};

		try {
			// Use the user-specific path
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			await docRef.update(updateData);
			logger.info({ sessionId, userId }, 'VibeSession updated successfully in user subcollection');
		} catch (error) {
			// Check if the error is due to the document not existing (e.g., Firestore error code 5)
			if ((error as any)?.code === 5) {
				logger.warn({ userId, sessionId }, 'Attempted to update non-existent VibeSession');
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
		// Security check: Ensure the requesting user matches the userId in the path
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to delete VibeSession for another user',
			);
			throw new Error('Not authorized to delete this Vibe session');
		}

		try {
			// Use the user-specific path
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Note: Firestore delete operation doesn't error if the document doesn't exist.
			// If we need to confirm existence before delete, a get() would be needed first.
			await docRef.delete();
			logger.info({ sessionId, userId }, 'VibeSession deleted successfully from user subcollection');
		} catch (error) {
			logger.error(error, `Error deleting VibeSession ${sessionId} for user ${userId}`);
			throw error;
		}
	}
}
