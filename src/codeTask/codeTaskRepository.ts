import type { CodeTask, CodeTaskPreset, UpdateCodeTaskData } from '#shared/codeTask/codeTask.model';

/**
 * Interface defining the persistence operations for Code tasks and presets.
 */
export interface CodeTaskRepository {
	/**
	 * Saves a new CodeTask to the persistent store.
	 * Implementations should handle setting appropriate timestamps if not provided.
	 * @param codeTask The complete CodeTask object to save.
	 * @returns The ID of the saved codeTask.
	 * @throws Error if a codeTask with the same ID already exists.
	 */
	createCodeTask(codeTask: CodeTask): Promise<string>;

	/**
	 * Retrieves a specific CodeTask by its ID for a given user.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to retrieve.
	 * @returns The CodeTask if found and authorized, otherwise null.
	 */
	getCodeTask(userId: string, codeTaskId: string): Promise<CodeTask | null>;

	/**
	 * Lists all CodeTasks for a specific user, ordered by creation date descending.
	 * @param userId The ID of the user whose codeTasks to list.
	 * @returns An array of CodeTasks.
	 */
	listCodeTasks(userId: string): Promise<CodeTask[]>;

	/**
	 * Updates specified fields of an existing CodeTask.
	 * Implementations should handle updating the 'updatedAt' timestamp.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to update.
	 * @param updates An object containing the fields to update.
	 * @throws Error if the codeTask is not found for the user.
	 */
	updateCodeTask(userId: string, codeTaskId: string, updates: UpdateCodeTaskData): Promise<void>;

	/**
	 * Deletes a CodeTask by its ID for a given user.
	 * Should not throw an error if the codeTask doesn't exist.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to delete.
	 */
	deleteCodeTask(userId: string, codeTaskId: string): Promise<void>;

	/**
	 * Saves a new CodeTaskPreset to the persistent store.
	 * Implementations should handle setting appropriate timestamps if not provided.
	 * @param preset The complete CodeTaskPreset object to save.
	 * @returns The ID of the saved preset.
	 * @throws Error if a preset with the same ID already exists.
	 */
	saveCodeTaskPreset(preset: CodeTaskPreset): Promise<string>;

	/**
	 * Lists all CodeTaskPresets for a specific user, ordered by creation date descending.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of CodeTaskPresets.
	 */
	listCodeTaskPresets(userId: string): Promise<CodeTaskPreset[]>;

	/**
	 * Deletes a CodeTaskPreset by its ID for a given user.
	 * Should not throw an error if the preset doesn't exist.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the CodeTaskPreset to delete.
	 */
	deleteCodeTaskPreset(userId: string, presetId: string): Promise<void>;
}
