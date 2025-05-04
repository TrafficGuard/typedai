import type { UpdateVibeSessionData, VibePreset, VibeSession } from './vibeTypes';

/**
 * Interface defining the persistence operations for Vibe sessions and presets.
 */
export interface VibeRepository {
	/**
	 * Saves a new VibeSession to the persistent store.
	 * Implementations should handle setting appropriate timestamps if not provided.
	 * @param session The complete VibeSession object to save.
	 * @returns The ID of the saved session.
	 * @throws Error if a session with the same ID already exists.
	 */
	createVibeSession(session: VibeSession): Promise<string>;

	/**
	 * Retrieves a specific VibeSession by its ID for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to retrieve.
	 * @returns The VibeSession if found and authorized, otherwise null.
	 */
	getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null>;

	/**
	 * Lists all VibeSessions for a specific user, ordered by creation date descending.
	 * @param userId The ID of the user whose sessions to list.
	 * @returns An array of VibeSessions.
	 */
	listVibeSessions(userId: string): Promise<VibeSession[]>;

	/**
	 * Updates specified fields of an existing VibeSession.
	 * Implementations should handle updating the 'updatedAt' timestamp.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to update.
	 * @param updates An object containing the fields to update.
	 * @throws Error if the session is not found for the user.
	 */
	updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void>;

	/**
	 * Deletes a VibeSession by its ID for a given user.
	 * Should not throw an error if the session doesn't exist.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to delete.
	 */
	deleteVibeSession(userId: string, sessionId: string): Promise<void>;

	/**
	 * Saves a new VibePreset to the persistent store.
	 * Implementations should handle setting appropriate timestamps if not provided.
	 * @param preset The complete VibePreset object to save.
	 * @returns The ID of the saved preset.
	 * @throws Error if a preset with the same ID already exists.
	 */
	saveVibePreset(preset: VibePreset): Promise<string>;

	/**
	 * Lists all VibePresets for a specific user, ordered by creation date descending.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of VibePresets.
	 */
	listVibePresets(userId: string): Promise<VibePreset[]>;

	/**
	 * Deletes a VibePreset by its ID for a given user.
	 * Should not throw an error if the preset doesn't exist.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the VibePreset to delete.
	 */
	deleteVibePreset(userId: string, presetId: string): Promise<void>;
}
