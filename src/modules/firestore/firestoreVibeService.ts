import { randomUUID } from 'node:crypto';
import { FieldValue, type Firestore } from '@google-cloud/firestore'; // Added FieldValue
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { currentUser } from '#user/userService/userContext';
import { firestoreDb } from './firestore';

// --- VibeSession interface and related types defined above ---
export interface VibeSession {
	id: string; // Primary key, ideally a UUID
	userId: string; // To associate with a user
	title: string;
	instructions: string;
	repositorySource: 'local' | 'github' | 'gitlab'; // Renamed from repositoryProvider
	repositoryId: string; // Renamed from repositoryIdentifier e.g., local path, 'owner/repo', 'group/project'
	repositoryName?: string; // Optional: e.g., 'my-cool-project'
	branch: string;
	newBranchName?: string; // Optional
	useSharedRepos: boolean;
	status: 'initializing' | 'design' | 'coding' | 'review' | 'completed' | 'error'; // Updated status values
	fileSelection?: { filePath: string; readOnly?: boolean }[]; // Updated fileSelection structure
	designAnswer?: string; // Store the generated design
	createdAt: FieldValue; // Changed type to FieldValue
	updatedAt: FieldValue; // Changed type to FieldValue
	error?: string; // Optional error message
}

// Define a type for the data needed to create a new session
// Note: Omit now includes 'error' as it's not provided at creation
export type CreateVibeSessionData = Omit<VibeSession, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'status' | 'error'>;

// Define a type for the data allowed in updates
export type UpdateVibeSessionData = Partial<Omit<VibeSession, 'id' | 'userId' | 'createdAt'>>;
// --- End Interface Definitions ---

const VIBE_SESSIONS_COLLECTION = 'vibeSessions';

/**
 * Service for managing VibeSession data in Firestore.
 */
export class FirestoreVibeService {
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
			const docRef = this.db.collection(VIBE_SESSIONS_COLLECTION).doc(newSessionData.id);
			// Firestore types require the data passed to set() to match the structure including timestamps
			await docRef.set(newSessionWithTimestamps);
			logger.info({ sessionId: newSessionData.id, userId }, 'VibeSession created successfully');

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
	 * Retrieves a specific VibeSession by its ID.
	 * Ensures the session belongs to the current user.
	 * @param id The ID of the VibeSession to retrieve.
	 * @returns The VibeSession if found and authorized, otherwise null.
	 */
	@span()
	async getVibeSession(id: string): Promise<VibeSession | null> {
		try {
			const docRef = this.db.collection(VIBE_SESSIONS_COLLECTION).doc(id);
			const docSnap = await docRef.get();

			if (!docSnap.exists) {
				logger.warn({ sessionId: id }, 'VibeSession not found');
				return null;
			}

			const session = docSnap.data() as VibeSession;

			// Authorization check
			if (session.userId !== currentUser().id) {
				logger.warn({ sessionId: id, currentUserId: currentUser().id, ownerId: session.userId }, 'User not authorized to access VibeSession');
				// Throw or return null based on desired behavior for unauthorized access
				// Returning null is less revealing than throwing an error.
				return null;
				// throw new Error('Not authorized to access this Vibe session');
			}

			return session;
		} catch (error) {
			logger.error(error, `Error retrieving VibeSession ${id}`);
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
			const querySnapshot = await this.db.collection(VIBE_SESSIONS_COLLECTION).where('userId', '==', userId).orderBy('createdAt', 'desc').get();

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
	 * Updates specified fields of a VibeSession.
	 * Ensures the session belongs to the current user before updating.
	 * @param id The ID of the VibeSession to update.
	 * @param updates An object containing the fields to update.
	 */
	@span()
	async updateVibeSession(id: string, updates: UpdateVibeSessionData): Promise<void> {
		// First, verify ownership before attempting update
		const existingSession = await this.getVibeSession(id);
		if (!existingSession) {
			// getVibeSession handles logging and authorization checks
			throw new Error(`VibeSession ${id} not found or user not authorized.`);
		}
		// Redundant check, but ensures currentUser() context hasn't changed unexpectedly
		if (existingSession.userId !== currentUser().id) {
			logger.error({ sessionId: id, currentUserId: currentUser().id }, 'Authorization failed during update attempt');
			throw new Error('Not authorized to update this Vibe session');
		}

		const updateData = {
			...updates,
			updatedAt: FieldValue.serverTimestamp(), // Use server timestamp
		};

		try {
			const docRef = this.db.collection(VIBE_SESSIONS_COLLECTION).doc(id);
			await docRef.update(updateData);
			logger.info({ sessionId: id, userId: currentUser().id }, 'VibeSession updated successfully');
		} catch (error) {
			logger.error(error, `Error updating VibeSession ${id}`);
			throw error;
		}
	}

	/**
	 * Deletes a VibeSession by its ID.
	 * Ensures the session belongs to the current user before deleting.
	 * @param id The ID of the VibeSession to delete.
	 */
	@span()
	async deleteVibeSession(id: string): Promise<void> {
		// First, verify ownership before attempting deletion
		const existingSession = await this.getVibeSession(id);
		if (!existingSession) {
			// getVibeSession handles logging and authorization checks
			throw new Error(`VibeSession ${id} not found or user not authorized.`);
		}
		// Redundant check
		if (existingSession.userId !== currentUser().id) {
			logger.error({ sessionId: id, currentUserId: currentUser().id }, 'Authorization failed during delete attempt');
			throw new Error('Not authorized to delete this Vibe session');
		}

		try {
			const docRef = this.db.collection(VIBE_SESSIONS_COLLECTION).doc(id);
			await docRef.delete();
			logger.info({ sessionId: id, userId: currentUser().id }, 'VibeSession deleted successfully');
		} catch (error) {
			logger.error(error, `Error deleting VibeSession ${id}`);
			throw error;
		}
	}
}
