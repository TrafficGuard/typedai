import { randomUUID } from 'node:crypto';
import { logger } from '#o11y/logger';
import { currentUser } from '#user/userService/userContext';
import type { VibeService } from '#vibe/vibeService';
import type { CreateVibeSessionData, UpdateVibeSessionData, VibeSession } from '#vibe/vibeTypes';

/**
 * In-memory implementation of the VibeService for testing or local development.
 */
export class InMemoryVibeService implements VibeService {
	private sessions: Map<string, VibeSession> = new Map();

	async createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession> {
		const now = new Date();
		const sessionId = randomUUID();
		const newSession: VibeSession = {
			...sessionData,
			id: sessionId,
			userId: userId,
			status: 'initializing',
			createdAt: now,
			updatedAt: now,
			lastAgentActivity: now, // Set initial activity timestamp
			// Other agent outputs (fileSelection, designAnswer, etc.) are initially undefined
		};
		this.sessions.set(sessionId, newSession);
		logger.info({ sessionId, userId }, 'In-memory VibeSession created');
		// TODO: Trigger asynchronous initialization (clone, select files, design) for sessionId
		return { ...newSession }; // Return a copy
	}

	async getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		// Security check: Ensure the requesting user matches the userId
		if (userId !== currentUser().id) {
			logger.warn({ requestedUserId: userId, currentUserId: currentUser().id, sessionId }, 'Attempt to get VibeSession for another user (in-memory)');
			return null; // Return null for unauthorized access attempts
		}

		const session = this.sessions.get(sessionId);
		// Check if the session exists AND belongs to the requesting user
		if (session && session.userId === userId) {
			logger.info({ userId, sessionId }, 'In-memory VibeSession retrieved successfully');
			return { ...session }; // Return a copy to prevent direct modification of the stored object
		}
		// Log if not found or if the user ID doesn't match (though the initial check should prevent the latter)
		logger.warn({ userId, sessionId }, 'In-memory VibeSession not found or user mismatch');
		return null;
	}

	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		// Security check: Ensure the operation is performed for the currently authenticated user
		if (userId !== currentUser().id) {
			logger.warn({ requestedUserId: userId, currentUserId: currentUser().id }, 'Attempt to list VibeSessions for another user (in-memory)');
			// Throw an error for unauthorized listing attempts
			throw new Error('Cannot list sessions for another user.');
		}

		// Filter sessions belonging to the user and sort them by creation date descending
		const userSessions = Array.from(this.sessions.values())
			.filter((session) => session.userId === userId)
			.sort((a, b) => ((b.createdAt as Date)?.getTime() ?? 0) - ((a.createdAt as Date)?.getTime() ?? 0)); // Handle potential undefined dates defensively

		logger.info({ userId, count: userSessions.length }, 'Listed in-memory VibeSessions');
		// Return copies of the sessions
		return userSessions.map((s) => ({ ...s }));
	}

	async updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		// Security check: Ensure the requesting user matches the userId
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to update VibeSession for another user (in-memory)',
			);
			// Throw an error for unauthorized update attempts
			throw new Error('Not authorized to update this Vibe session');
		}

		const existingSession = this.sessions.get(sessionId);
		// Check if the session exists AND belongs to the requesting user
		if (!existingSession || existingSession.userId !== userId) {
			logger.warn({ userId, sessionId }, 'Attempted to update non-existent or unauthorized VibeSession (in-memory)');
			// Throw an error if the session doesn't exist or doesn't belong to the user
			throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		}

		// Create the updated session object, merging existing data with updates and setting a new updatedAt timestamp
		const updatedSession: VibeSession = {
			...existingSession,
			...updates,
			updatedAt: new Date(), // Update the timestamp
		};
		// Store the updated session back into the map
		this.sessions.set(sessionId, updatedSession);
		logger.info({ sessionId, userId }, 'In-memory VibeSession updated');
	}

	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		// Security check: Ensure the requesting user matches the userId
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to delete VibeSession for another user (in-memory)',
			);
			// Throw an error for unauthorized delete attempts
			throw new Error('Not authorized to delete this Vibe session');
		}

		const session = this.sessions.get(sessionId);
		// Check if the session exists AND belongs to the requesting user before deleting
		if (session && session.userId === userId) {
			this.sessions.delete(sessionId);
			logger.info({ sessionId, userId }, 'In-memory VibeSession deleted');
		} else {
			// Log a warning if attempting to delete a session that doesn't exist or doesn't belong to the user
			// Deleting a non-existent session is often not treated as an error, hence a warning.
			logger.warn({ userId, sessionId }, 'Attempted to delete non-existent or unauthorized VibeSession (in-memory)');
			// Optionally, throw an error if strict behavior is required:
			// throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		}
	}

	// --- Workflow Actions ---

	async updateDesignWithInstructions(userId: string, sessionId: string, data: import('#vibe/vibeTypes').UpdateDesignInstructionsData): Promise<void> {
		// Security check: Ensure the requesting user matches the userId
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to update design instructions for another user (in-memory)',
			);
			throw new Error('Not authorized to update this Vibe session');
		}

		try {
			const session = await this.getVibeSession(userId, sessionId);
			if (!session) {
				logger.error({ userId, sessionId }, 'VibeSession not found when attempting to update design (in-memory).');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}

			// Validate status - log warning if unexpected, but proceed
			if (session.status !== 'design_review') {
				logger.warn({ userId, sessionId, status: session.status }, 'Updating design from unexpected status (in-memory)');
			}

			logger.info({ userId, sessionId }, 'Updating design with new instructions (in-memory)...');

			// Update the session status and timestamp
			await this.updateVibeSession(userId, sessionId, {
				status: 'design_review', // Keep or set status to indicate design phase
				lastAgentActivity: new Date(),
				// Optionally store the new instructions if needed
				// designInstructions: data.instructions, // Example
			});

			// TODO: Trigger Design Agent with session details (session.designAnswer, session.fileSelection) and data.instructions
			// Example: agentManager.triggerDesignUpdate(sessionId, session, data.instructions);

			logger.info({ userId, sessionId }, 'Design update process initiated (in-memory).');
		} catch (error) {
			logger.error(error, `Error updating design instructions for VibeSession ${sessionId}, user ${userId} (in-memory)`);
			// Re-throw the error after logging
			throw error;
		}
	}

	async startCoding(userId: string, sessionId: string): Promise<void> {
		// Security check: Ensure the requesting user matches the userId
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to start coding for another user (in-memory)',
			);
			throw new Error('Not authorized to start coding for this Vibe session');
		}

		try {
			const session = await this.getVibeSession(userId, sessionId);
			if (!session) {
				logger.error({ userId, sessionId }, 'VibeSession not found when attempting to start coding (in-memory).');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}

			// Validate status - ideally should be in 'design_review' or similar
			if (session.status !== 'design_review') {
				logger.warn({ userId, sessionId, status: session.status }, 'Starting coding from unexpected status (in-memory)');
			}

			logger.info({ userId, sessionId }, 'Starting coding process (in-memory)...');

			// Update the session status and timestamp
			await this.updateVibeSession(userId, sessionId, {
				status: 'coding',
				lastAgentActivity: new Date(),
			});

			// TODO: Trigger CodeEditingAgent with session details (session.fileSelection, session.designAnswer)
			// Example: agentManager.triggerCodeEditing(sessionId, session);

			logger.info({ userId, sessionId }, 'Coding process initiated (in-memory).');
		} catch (error) {
			logger.error(error, `Error starting coding for VibeSession ${sessionId}, user ${userId} (in-memory)`);
			// Re-throw the error after logging
			throw error;
		}
	}

	async updateCodeWithComments(userId: string, sessionId: string, data: import('#vibe/vibeTypes').UpdateCodeReviewData): Promise<void> {
		// Security check: Ensure the requesting user matches the userId
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to update code with comments for another user (in-memory)',
			);
			throw new Error('Not authorized to update this Vibe session');
		}

		try {
			const session = await this.getVibeSession(userId, sessionId);
			if (!session) {
				logger.error({ userId, sessionId }, 'VibeSession not found when attempting to update code with comments (in-memory).');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}

			// Validate status - ideally should be in 'code_review' or similar
			if (session.status !== 'code_review') {
				// Assuming 'code_review' is the expected status
				logger.warn({ userId, sessionId, status: session.status }, 'Updating code from unexpected status (in-memory)');
			}

			logger.info({ userId, sessionId }, 'Requesting code revisions based on comments (in-memory)...');

			// Update the session status back to 'coding' and update the timestamp
			await this.updateVibeSession(userId, sessionId, {
				status: 'coding', // Go back to coding state
				lastAgentActivity: new Date(),
			});

			// TODO: Trigger CodeEditingAgent with session details (session.codeDiff, session.designAnswer) and data.reviewComments
			// Example: agentManager.triggerCodeRevision(sessionId, session, data.reviewComments);

			logger.info({ userId, sessionId }, 'Code revision process initiated (in-memory).');
		} catch (error) {
			logger.error(error, `Error updating code with comments for VibeSession ${sessionId}, user ${userId} (in-memory)`);
			// Re-throw the error after logging
			throw error;
		}
	}

	async commitChanges(
		userId: string,
		sessionId: string,
		data: import('#vibe/vibeTypes').CommitChangesData,
	): Promise<{ commitSha: string; pullRequestUrl?: string }> {
		// Security check: Ensure the requesting user matches the userId
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to commit changes for another user (in-memory)',
			);
			throw new Error('Not authorized to commit changes for this Vibe session');
		}

		try {
			const session = await this.getVibeSession(userId, sessionId);
			if (!session) {
				logger.error({ userId, sessionId }, 'VibeSession not found when attempting to commit changes (in-memory).');
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}

			// Validate status - ideally should be in 'code_review' or similar
			if (session.status !== 'code_review') {
				logger.warn({ userId, sessionId, status: session.status }, 'Committing changes from unexpected status (in-memory)');
			}

			logger.info({ userId, sessionId, commitTitle: data.commitTitle }, 'Starting commit process (in-memory)...');

			// Update the session status to 'committing'
			await this.updateVibeSession(userId, sessionId, {
				status: 'committing',
				lastAgentActivity: new Date(),
			});

			// TODO: Implement actual git commit, push, and PR/MR creation logic using SCM functions/services
			// This section should interact with the appropriate SCM service (GitHub, GitLab, local Git)
			// based on session.repositorySource and session.repositoryId.
			// It needs access to the session's workspace/cloned repository.

			// Simulate SCM operations success
			const dummyCommitSha = 'simulated-inmemory-commit-sha';
			const dummyPrUrl = session.repositorySource !== 'local' ? `https://example.com/pr/123-inmemory-${sessionId.substring(0, 8)}` : undefined; // Example PR URL
			logger.info({ userId, sessionId, dummyCommitSha, dummyPrUrl }, 'Simulated SCM operations complete (in-memory).');

			// Update the session status to 'completed' and store results
			await this.updateVibeSession(userId, sessionId, {
				status: 'completed',
				commitSha: dummyCommitSha,
				pullRequestUrl: dummyPrUrl,
				lastAgentActivity: new Date(),
			});

			logger.info({ userId, sessionId }, 'Commit process completed (in-memory).');
			return { commitSha: dummyCommitSha, pullRequestUrl: dummyPrUrl };
		} catch (error) {
			logger.error(error, `Error committing changes for VibeSession ${sessionId}, user ${userId} (in-memory)`);
			// Optionally update status to 'error'
			try {
				// Need to fetch again as updateVibeSession requires the full object in memory
				const currentSession = this.sessions.get(sessionId);
				if (currentSession && currentSession.userId === userId) {
					await this.updateVibeSession(userId, sessionId, {
						status: 'error',
						lastAgentActivity: new Date(),
					});
				}
			} catch (updateError) {
				logger.error(updateError, `Failed to update VibeSession status to error after commit failure for session ${sessionId} (in-memory)`);
			}
			// Re-throw the original error
			throw error;
		}
	}

	// --- Placeholder Helper Methods ---

	async getBranchList(userId: string, repositorySource: 'local' | 'github' | 'gitlab', repositoryId: string): Promise<string[]> {
		// Optional: Add security check if needed, similar to Firestore version
		logger.warn({ userId, repositorySource, repositoryId }, 'InMemoryVibeService.getBranchList placeholder called');
		// TODO: Implement logic to call appropriate SCM service/function
		return Promise.resolve(['main', 'develop', 'feature/placeholder-inmemory']);
	}

	async getFileSystemTree(userId: string, sessionId: string, directoryPath?: string): Promise<import('#vibe/vibeTypes').FileSystemNode[]> {
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId, directoryPath },
				'Authorization failed: Attempt to get file system tree for another user (in-memory)',
			);
			throw new Error('Not authorized to access file system tree for this session');
		}
		logger.warn({ userId, sessionId, directoryPath }, 'InMemoryVibeService.getFileSystemTree placeholder called');
		// TODO: Implement logic to interact with the FileSystemService or agent context filesystem for the session workspace
		return Promise.resolve([
			{ path: 'test', name: 'test', type: 'directory' },
			{ path: 'config.json', name: 'config.json', type: 'file' },
		]);
	}

	async getFileContent(userId: string, sessionId: string, filePath: string): Promise<string> {
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId, filePath },
				'Authorization failed: Attempt to get file content for another user (in-memory)',
			);
			throw new Error('Not authorized to access file content for this session');
		}
		logger.warn({ userId, sessionId, filePath }, 'InMemoryVibeService.getFileContent placeholder called');
		// TODO: Implement logic to interact with the FileSystemService or agent context filesystem to read file content from the session workspace
		return Promise.resolve(`// Placeholder content for ${filePath} from InMemoryVibeService`);
	}

	// Optional method
	async applyCiCdFix(userId: string, sessionId: string): Promise<void> {
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to apply CI/CD fix for another user (in-memory)',
			);
			throw new Error('Not authorized to apply CI/CD fix for this session');
		}

		const session = await this.getVibeSession(userId, sessionId);
		if (!session) {
			logger.error({ userId, sessionId }, 'VibeSession not found when attempting to apply CI/CD fix (in-memory).');
			throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		}

		logger.warn({ userId, sessionId }, 'InMemoryVibeService.applyCiCdFix placeholder called');
		// TODO: Implement logic to trigger agent/process to apply CI/CD fix based on session.ciCdProposedFix

		// Simulate going back to coding state after initiating the fix process
		await this.updateVibeSession(userId, sessionId, {
			status: 'coding', // Or a dedicated 'applying_fix' status
			lastAgentActivity: new Date(),
		});
		logger.info({ userId, sessionId }, 'Simulated CI/CD fix application: status set to coding (in-memory).');
	}
}
