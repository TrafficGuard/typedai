import type { VibeRepository } from '#vibe/vibeRepository';
import type { UpdateVibeSessionData, VibePreset, VibeSession } from '#vibe/vibeTypes';

/**
 * In-memory implementation of VibeRepository for testing and development.
 * Simulates data persistence without external dependencies.
 */
export class InMemoryVibeRepository implements VibeRepository {
	private sessions: Map<string, VibeSession> = new Map();
	private presets: Map<string, VibePreset> = new Map();

	// Helper to simulate server timestamp behavior
	private getServerTimestamp(): number {
		return Date.now();
	}

	// --- Session CRUD ---

	async createVibeSession(session: VibeSession): Promise<string> {
		if (!session.id || !session.userId) {
			throw new Error('Session ID and User ID must be provided');
		}
		if (this.sessions.has(session.id)) {
			throw new Error(`Session with ID ${session.id} already exists.`);
		}
		const now = this.getServerTimestamp();
		const sessionToSave: VibeSession = {
			...session,
			createdAt: session.createdAt || now,
			updatedAt: session.updatedAt || now,
			lastAgentActivity: session.lastAgentActivity || now,
		};
		this.sessions.set(session.id, sessionToSave);
		return session.id;
	}

	async getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		const session = this.sessions.get(sessionId);
		// Basic authorization check (in-memory doesn't have user context like Firestore)
		if (session && session.userId === userId) {
			return { ...session }; // Return a copy to prevent mutation
		}
		return null;
	}

	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		const userSessions = Array.from(this.sessions.values())
			.filter((s) => s.userId === userId)
			.sort((a, b) => (b.createdAt as number) - (a.createdAt as number)); // Descending order

		return userSessions.map((s) => ({ ...s })); // Return copies
	}

	async updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		const existingSession = this.sessions.get(sessionId);
		if (!existingSession || existingSession.userId !== userId) {
			throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		}

		const now = this.getServerTimestamp();
		const updatedSession: VibeSession = {
			...existingSession,
			...updates,
			updatedAt: updates.updatedAt || now, // Use provided or generate new timestamp
			// lastAgentActivity should be explicitly included in updates if it changes
		};

		this.sessions.set(sessionId, updatedSession);
	}

	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		// Only delete if it exists and belongs to the user
		if (session && session.userId === userId) {
			this.sessions.delete(sessionId);
		}
		// No error if not found, matching Firestore behavior
	}

	// --- Preset CRUD ---

	async saveVibePreset(preset: VibePreset): Promise<string> {
		if (!preset.id || !preset.userId || !preset.name) {
			throw new Error('Preset ID, User ID, and Name must be provided');
		}
		if (this.presets.has(preset.id)) {
			throw new Error(`Preset with ID ${preset.id} already exists.`);
		}
		const now = Date.now();
		const presetToSave: VibePreset = {
			...preset,
			createdAt: preset.createdAt || now,
			updatedAt: preset.updatedAt || now,
		};
		this.presets.set(preset.id, presetToSave);
		return preset.id;
	}

	async listVibePresets(userId: string): Promise<VibePreset[]> {
		const userPresets = Array.from(this.presets.values())
			.filter((p) => p.userId === userId)
			.sort((a, b) => (b.createdAt as number) - (a.createdAt as number)); // Descending order

		return userPresets.map((p) => ({ ...p })); // Return copies
	}

	async deleteVibePreset(userId: string, presetId: string): Promise<void> {
		const preset = this.presets.get(presetId);
		// Only delete if it exists and belongs to the user
		if (preset && preset.userId === userId) {
			this.presets.delete(presetId);
		}
		// No error if not found
	}

	// --- Test Helper ---
	/** Clears all data from the in-memory store. For testing purposes only. */
	clear(): void {
		this.sessions.clear();
		this.presets.clear();
	}
}
