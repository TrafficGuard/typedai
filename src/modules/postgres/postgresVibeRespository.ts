import type { UpdateVibeSessionData, VibePreset, VibeSession } from '#shared/model/vibe.model';
import type { VibeRepository } from '#vibe/vibeRepository';

// See FirestoreVibeRepository for an implementation of VibeRepository

export class PostgresVibeRepository implements VibeRepository {
	createVibeSession(session: VibeSession): Promise<string> {
		return Promise.resolve('');
	}

	deleteVibePreset(userId: string, presetId: string): Promise<void> {
		return Promise.resolve(undefined);
	}

	deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		return Promise.resolve(undefined);
	}

	getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		return Promise.resolve(undefined);
	}

	listVibePresets(userId: string): Promise<VibePreset[]> {
		return Promise.resolve([]);
	}

	listVibeSessions(userId: string): Promise<VibeSession[]> {
		return Promise.resolve([]);
	}

	saveVibePreset(preset: VibePreset): Promise<string> {
		return Promise.resolve('');
	}

	updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		return Promise.resolve(undefined);
	}
}
