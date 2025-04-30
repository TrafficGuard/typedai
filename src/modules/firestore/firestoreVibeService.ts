import { randomUUID } from 'node:crypto';
import { FieldValue, type Firestore } from '@google-cloud/firestore';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { currentUser } from '#user/userService/userContext';
import type { VibeService } from '#vibe/vibeService';
import type { CreateVibeSessionData, UpdateVibeSessionData, VibeSession } from '#vibe/vibeTypes'; // Import the types
import { firestoreDb } from './firestore';

const VIBE_SESSIONS_COLLECTION = 'vibeSessions';

/**
 * Firestore implementation for managing VibeSession data.
 */
export class FirestoreVibeService implements VibeService {
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
		const sessionId = randomUUID();
		const newSessionData: Omit<VibeSession, 'createdAt' | 'updatedAt' | 'lastAgentActivity'> = {
			// Type helps ensure all fields are covered before timestamps
			...sessionData,
			id: sessionId,
			userId: userId,
			status: 'initializing', // Set initial status
			// Ensure lastAgentActivity is not set here, will be set by agent actions
			// Other agent outputs (fileSelection, designAnswer, etc.) are initially undefined
		};

		const newSessionWithTimestamps = {
			...newSessionData,
			createdAt: FieldValue.serverTimestamp(),
			updatedAt: FieldValue.serverTimestamp(),
			lastAgentActivity: FieldValue.serverTimestamp(), // Set initial activity timestamp
		};

		try {
			// Use the user-specific path
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Firestore types require the data passed to set() to match the structure including timestamps
			await docRef.set(newSessionWithTimestamps);
			logger.info({ sessionId, userId }, 'VibeSession created successfully in user subcollection');

			// TODO: Trigger asynchronous initialization (clone, select files, design) for sessionId

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
		// Ensure the operation is performed for the currently authenticated user
		if (userId !== currentUser().id) {
			logger.warn({ requestedUserId: userId, currentUserId: currentUser().id }, 'Attempt to list VibeSessions for another user');
			// Throw an error for unauthorized listing attempts
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
		// Security check: Ensure the requesting user matches the userId in the path
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to update VibeSession for another user',
			);
			// Throw an error for unauthorized update attempts
			throw new Error('Not authorized to update this Vibe session');
		}

		// The type UpdateVibeSessionData already excludes id, userId, and createdAt.
		// We just need to add the server timestamp for updatedAt.
		const updateData = {
			...updates,
			updatedAt: FieldValue.serverTimestamp(), // Use server timestamp for update time
		};

		try {
			// Use the user-specific path
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			await docRef.update(updateData);
			logger.info({ sessionId, userId }, 'VibeSession updated successfully in user subcollection');
		} catch (error) {
			// Check if the error is due to the document not existing (e.g., Firestore error code 5)
			if ((error as any)?.code === 5) {
				// Firestore error code for NOT_FOUND
				logger.warn({ userId, sessionId }, 'Attempted to update non-existent VibeSession');
				// Throw a more specific error if the session doesn't exist
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}
			logger.error(error, `Error updating VibeSession ${sessionId} for user ${userId}`);
			throw error; // Re-throw other errors after logging
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
			// Throw an error for unauthorized delete attempts
			throw new Error('Not authorized to delete this Vibe session');
		}

		try {
			// Use the user-specific path
			const docRef = this.db.collection('users').doc(userId).collection(VIBE_SESSIONS_COLLECTION).doc(sessionId);
			// Note: Firestore delete operation doesn't error if the document doesn't exist.
			// This is generally acceptable behavior. If confirmation of existence before delete
			// is required, a get() call would be needed first, but that adds latency.
			await docRef.delete();
			logger.info({ sessionId, userId }, 'VibeSession deleted successfully from user subcollection');
		} catch (error) {
			logger.error(error, `Error deleting VibeSession ${sessionId} for user ${userId}`);
			throw error; // Re-throw after logging
		}
	}

	// --- Placeholder Workflow Actions ---

	@span()
	async updateDesignWithInstructions(userId: string, sessionId: string, data: import('#vibe/vibeTypes').UpdateDesignInstructionsData): Promise<void> {
		// Security check: Ensure the requesting user matches the userId in the path
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to update design instructions for another user',
			);
			throw new Error('Not authorized to update this Vibe session');
		}

		try {
			const session = await this.getVibeSession(userId, sessionId);
			if (!session) {
				logger.error({ userId, sessionId }, 'VibeSession not found when attempting to update design.');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}

			// Validate status - ideally should be in 'design_review' or similar, but allow for now
			// In a stricter implementation, you might throw an error if the status is not appropriate.
			if (session.status !== 'design_review') {
				logger.warn({ userId, sessionId, status: session.status }, 'Updating design from unexpected status');
			}

			logger.info({ userId, sessionId }, 'Updating design with new instructions...');

			// Update the session status and timestamp
			await this.updateVibeSession(userId, sessionId, {
				status: 'design_review', // Keep or set status to indicate design phase
				lastAgentActivity: FieldValue.serverTimestamp(),
				// Optionally store the new instructions if needed, depends on data model
				// designInstructions: data.instructions, // Example if storing instructions
			});

			// TODO: Trigger Design Agent with session details (session.designAnswer, session.fileSelection) and data.instructions
			// This would likely involve queuing a task or calling another service/agent manager.
			// Example: agentManager.triggerDesignUpdate(sessionId, session, data.instructions);

			logger.info({ userId, sessionId }, 'Design update process initiated.');
		} catch (error) {
			logger.error(error, `Error updating design instructions for VibeSession ${sessionId}, user ${userId}`);
			// Re-throw the error after logging
			throw error;
		}
	}

	@span()
	async startCoding(userId: string, sessionId: string): Promise<void> {
		// Security check: Ensure the requesting user matches the userId in the path
		if (userId !== currentUser().id) {
			logger.error({ requestedUserId: userId, currentUserId: currentUser().id, sessionId }, 'Authorization failed: Attempt to start coding for another user');
			throw new Error('Not authorized to start coding for this Vibe session');
		}

		try {
			const session = await this.getVibeSession(userId, sessionId);
			if (!session) {
				logger.error({ userId, sessionId }, 'VibeSession not found when attempting to start coding.');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}

			// Validate status - ideally should be in 'design_review' or similar
			// Log a warning if starting from an unexpected state, but proceed for flexibility.
			if (session.status !== 'design_review') {
				logger.warn({ userId, sessionId, status: session.status }, 'Starting coding from unexpected status');
			}

			logger.info({ userId, sessionId }, 'Starting coding process...');

			// Update the session status and timestamp
			await this.updateVibeSession(userId, sessionId, {
				status: 'coding',
				lastAgentActivity: FieldValue.serverTimestamp(),
			});

			// TODO: Trigger CodeEditingAgent with session details (session.fileSelection, session.designAnswer)
			// This would likely involve queuing a task or calling another service/agent manager.
			// Example: agentManager.triggerCodeEditing(sessionId, session);

			logger.info({ userId, sessionId }, 'Coding process initiated.');
		} catch (error) {
			logger.error(error, `Error starting coding for VibeSession ${sessionId}, user ${userId}`);
			// Re-throw the error after logging
			throw error;
		}
	}

	@span()
	async updateCodeWithComments(userId: string, sessionId: string, data: import('#vibe/vibeTypes').UpdateCodeReviewData): Promise<void> {
		// Security check: Ensure the requesting user matches the userId in the path
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to update code with comments for another user',
			);
			throw new Error('Not authorized to update this Vibe session');
		}

		try {
			const session = await this.getVibeSession(userId, sessionId);
			if (!session) {
				logger.error({ userId, sessionId }, 'VibeSession not found when attempting to update code with comments.');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}

			// Validate status - ideally should be in 'code_review' or similar
			// Log a warning if starting from an unexpected state, but proceed for flexibility.
			if (session.status !== 'code_review') {
				// Assuming 'code_review' is the expected status before applying comments
				logger.warn({ userId, sessionId, status: session.status }, 'Updating code from unexpected status');
			}

			logger.info({ userId, sessionId }, 'Requesting code revisions based on comments...');

			// Update the session status back to 'coding' and update the timestamp
			await this.updateVibeSession(userId, sessionId, {
				status: 'coding', // Go back to coding state to apply revisions
				lastAgentActivity: FieldValue.serverTimestamp(),
			});

			// TODO: Trigger CodeEditingAgent with session details (session.codeDiff, session.designAnswer) and data.reviewComments
			// This would likely involve queuing a task or calling another service/agent manager.
			// Example: agentManager.triggerCodeRevision(sessionId, session, data.reviewComments);

			logger.info({ userId, sessionId }, 'Code revision process initiated.');
		} catch (error) {
			logger.error(error, `Error updating code with comments for VibeSession ${sessionId}, user ${userId}`);
			// Re-throw the error after logging
			throw error;
		}
	}

	@span()
	async commitChanges(
		userId: string,
		sessionId: string,
		data: import('#vibe/vibeTypes').CommitChangesData,
	): Promise<{ commitSha: string; pullRequestUrl?: string }> {
		// Security check: Ensure the requesting user matches the userId in the path
		if (userId !== currentUser().id) {
			logger.error({ requestedUserId: userId, currentUserId: currentUser().id, sessionId }, 'Authorization failed: Attempt to commit changes for another user');
			throw new Error('Not authorized to commit changes for this Vibe session');
		}

		try {
			const session = await this.getVibeSession(userId, sessionId);
			if (!session) {
				logger.error({ userId, sessionId }, 'VibeSession not found when attempting to commit changes.');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}

			// Validate status - ideally should be in 'code_review' or similar
			// Log a warning if committing from an unexpected state, but proceed for flexibility.
			if (session.status !== 'code_review') {
				logger.warn({ userId, sessionId, status: session.status }, 'Committing changes from unexpected status');
			}

			logger.info({ userId, sessionId, commitTitle: data.commitTitle }, 'Starting commit process...');

			// Update the session status to 'committing'
			await this.updateVibeSession(userId, sessionId, {
				status: 'committing',
				lastAgentActivity: FieldValue.serverTimestamp(),
			});

			// TODO: Implement actual git commit (using data.commitTitle, data.commitMessage), push, and PR/MR creation logic using SCM functions/services based on session.repositorySource
			// This section should interact with the appropriate SCM service (GitHub, GitLab, local Git)
			// based on session.repositorySource and session.repositoryId.
			// It needs access to the session's workspace/cloned repository.

			// Simulate SCM operations success
			const dummyCommitSha = 'simulated-firestore-commit-sha';
			const dummyPrUrl = session.repositorySource !== 'local' ? `https://example.com/pr/123-firestore-${sessionId.substring(0, 8)}` : undefined; // Example PR URL
			logger.info({ userId, sessionId, dummyCommitSha, dummyPrUrl }, 'Simulated SCM operations complete.');

			// Update the session status to 'completed' (or 'monitoring_ci' if implemented) and store results
			await this.updateVibeSession(userId, sessionId, {
				status: 'completed', // Change to 'monitoring_ci' if CI monitoring is the next step
				commitSha: dummyCommitSha,
				pullRequestUrl: dummyPrUrl,
				lastAgentActivity: FieldValue.serverTimestamp(),
			});

			logger.info({ userId, sessionId }, 'Commit process completed.');
			return { commitSha: dummyCommitSha, pullRequestUrl: dummyPrUrl };
		} catch (error) {
			logger.error(error, `Error committing changes for VibeSession ${sessionId}, user ${userId}`);
			// Optionally update status to 'error'
			try {
				await this.updateVibeSession(userId, sessionId, {
					status: 'error',
					lastAgentActivity: FieldValue.serverTimestamp(),
				});
			} catch (updateError) {
				logger.error(updateError, `Failed to update VibeSession status to error after commit failure for session ${sessionId}`);
			}
			// Re-throw the original error
			throw error;
		}
	}

	// --- Placeholder Helper Methods ---

	@span()
	async getBranchList(userId: string, repositorySource: 'local' | 'github' | 'gitlab', repositoryId: string): Promise<string[]> {
		// Optional: Add security check if SCM access needs user context beyond just userId
		logger.warn({ userId, repositorySource, repositoryId }, 'FirestoreVibeService.getBranchList placeholder called');
		// TODO: Implement logic to call appropriate SCM service/function (e.g., GitHub/GitLab client)
		// This might involve retrieving SCM credentials associated with the user or session.
		return Promise.resolve(['main', 'develop', 'feature/placeholder-firestore']);
	}

	@span()
	async getFileSystemTree(userId: string, sessionId: string, directoryPath?: string): Promise<import('#vibe/vibeTypes').FileSystemNode[]> {
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId, directoryPath },
				'Authorization failed: Attempt to get file system tree for another user',
			);
			throw new Error('Not authorized to access file system tree for this session');
		}
		logger.warn({ userId, sessionId, directoryPath }, 'FirestoreVibeService.getFileSystemTree placeholder called');
		// TODO: Implement logic to interact with the FileSystemService or agent context filesystem for the session workspace
		// This requires access to the session's workspace path, potentially stored in the session document or derived.
		return Promise.resolve([
			{ path: 'src', name: 'src', type: 'directory' },
			{ path: 'README.md', name: 'README.md', type: 'file' },
		]);
	}

	@span()
	async getFileContent(userId: string, sessionId: string, filePath: string): Promise<string> {
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId, filePath },
				'Authorization failed: Attempt to get file content for another user',
			);
			throw new Error('Not authorized to access file content for this session');
		}
		logger.warn({ userId, sessionId, filePath }, 'FirestoreVibeService.getFileContent placeholder called');
		// TODO: Implement logic to interact with the FileSystemService or agent context filesystem to read file content from the session workspace
		// This requires access to the session's workspace path and the specific file path.
		return Promise.resolve(`// Placeholder content for ${filePath} from FirestoreVibeService`);
	}

	// Optional method
	@span()
	async applyCiCdFix(userId: string, sessionId: string): Promise<void> {
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to apply CI/CD fix for another user',
			);
			throw new Error('Not authorized to apply CI/CD fix for this session');
		}

		const session = await this.getVibeSession(userId, sessionId);
		if (!session) {
			logger.error({ userId, sessionId }, 'VibeSession not found when attempting to apply CI/CD fix.');
			throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		}

		logger.warn({ userId, sessionId }, 'FirestoreVibeService.applyCiCdFix placeholder called');
		// TODO: Implement logic to trigger agent/process to apply CI/CD fix based on session.ciCdProposedFix
		// This might involve retrieving the proposed fix details from the session and initiating a new agent run or specific function call.

		// Simulate going back to coding state after initiating the fix process
		await this.updateVibeSession(userId, sessionId, {
			status: 'coding', // Or a dedicated 'applying_fix' status
			lastAgentActivity: FieldValue.serverTimestamp(),
		});
		logger.info({ userId, sessionId }, 'Simulated CI/CD fix application: status set to coding.');
	}
}
