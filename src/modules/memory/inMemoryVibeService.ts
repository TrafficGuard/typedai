import { randomUUID } from 'node:crypto';
import { logger } from '#o11y/logger';
import { currentUser } from '#user/userService/userContext';
import type { CreateVibeSessionData, UpdateVibeSessionData, VibeService, VibeSession } from '#vibe/vibeTypes';

/**
 * In-memory implementation of the VibeService for testing or local development.
 */
export class InMemoryVibeService implements VibeService {
	private sessions: Map<string, VibeSession> = new Map();

	async createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession> {
		const now = new Date();
		const newSession: VibeSession = {
			...sessionData,
			id: randomUUID(),
			userId: userId,
			status: 'initializing',
			createdAt: now,
			updatedAt: now,
		};
		this.sessions.set(newSession.id, newSession);
		logger.info({ sessionId: newSession.id, userId }, 'In-memory VibeSession created');
		return { ...newSession }; // Return a copy
	}

	async getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		// Security check
		if (userId !== currentUser().id) {
			logger.warn({ requestedUserId: userId, currentUserId: currentUser().id, sessionId }, 'Attempt to get VibeSession for another user (in-memory)');
			return null;
		}

		const session = this.sessions.get(sessionId);
		if (session && session.userId === userId) {
			return { ...session }; // Return a copy
		}
		logger.warn({ userId, sessionId }, 'In-memory VibeSession not found or user mismatch');
		return null;
	}

	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		// Security check
		if (userId !== currentUser().id) {
			logger.warn({ requestedUserId: userId, currentUserId: currentUser().id }, 'Attempt to list VibeSessions for another user (in-memory)');
			throw new Error('Cannot list sessions for another user.');
		}

		const userSessions = Array.from(this.sessions.values())
			.filter((session) => session.userId === userId)
			.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()); // Sort by date descending

		logger.info({ userId, count: userSessions.length }, 'Listed in-memory VibeSessions');
		return userSessions.map((s) => ({ ...s })); // Return copies
	}

	async updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		// Security check
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to update VibeSession for another user (in-memory)',
			);
			throw new Error('Not authorized to update this Vibe session');
		}

		const existingSession = this.sessions.get(sessionId);
		if (!existingSession || existingSession.userId !== userId) {
			logger.warn({ userId, sessionId }, 'Attempted to update non-existent or unauthorized VibeSession (in-memory)');
			throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		}

		const updatedSession: VibeSession = {
			...existingSession,
			...updates,
			updatedAt: new Date(),
		};
		this.sessions.set(sessionId, updatedSession);
		logger.info({ sessionId, userId }, 'In-memory VibeSession updated');
	}

	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		// Security check
		if (userId !== currentUser().id) {
			logger.error(
				{ requestedUserId: userId, currentUserId: currentUser().id, sessionId },
				'Authorization failed: Attempt to delete VibeSession for another user (in-memory)',
			);
			throw new Error('Not authorized to delete this Vibe session');
		}

		const session = this.sessions.get(sessionId);
		if (session && session.userId === userId) {
			this.sessions.delete(sessionId);
			logger.info({ sessionId, userId }, 'In-memory VibeSession deleted');
		} else {
			// Deleting a non-existent session is often not an error, log as info/warn
			logger.warn({ userId, sessionId }, 'Attempted to delete non-existent or unauthorized VibeSession (in-memory)');
			// Optionally throw an error if required:
			// throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		}
	}
}
