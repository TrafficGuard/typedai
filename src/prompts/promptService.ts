import type { Prompt, PromptPreview } from '#shared/model/prompts.model';

export interface PromptsService {
	/**
	 * Retrieves the latest revision of a specific prompt.
	 * @param promptId The ID of the prompt.
	 * @param userId The ID of the user owning the prompt.
	 * @returns A promise that resolves to the Prompt object or null if not found.
	 */
	getPrompt(promptId: string, userId: string): Promise<Prompt | null>;

	/**
	 * Retrieves a specific revision of a prompt.
	 * @param promptId The ID of the prompt.
	 * @param revisionId The revision number of the prompt.
	 * @param userId The ID of the user owning the prompt.
	 * @returns A promise that resolves to the Prompt object or null if not found.
	 */
	getPromptVersion(promptId: string, revisionId: number, userId: string): Promise<Prompt | null>;

	/**
	 * Lists all prompts (latest revisions) for a given user, returning previews.
	 * @param userId The ID of the user.
	 * @returns A promise that resolves to an array of PromptPreview objects.
	 */
	listPromptsForUser(userId: string): Promise<PromptPreview[]>;

	/**
	 * Creates a new prompt. The first revision will be 1.
	 * The 'id' for the prompt group will be auto-generated.
	 * 'userId' will be assigned from the parameter.
	 * 'revisionId' will be set to 1.
	 * @param promptData Data for the new prompt, excluding id, revisionId, and userId.
	 * @param userId The ID of the user creating the prompt.
	 * @returns A promise that resolves to the created Prompt object (which includes the new id and revisionId=1).
	 */
	createPrompt(promptData: Omit<Prompt, 'id' | 'revisionId' | 'userId'>, userId: string): Promise<Prompt>;

	/**
	 * Updates an existing prompt.
	 * If newVersion is true, a new revision is created by incrementing the latest revisionId for that promptId.
	 * If newVersion is false, the latest revision of the prompt (identified by promptId) is updated in place.
	 * @param promptId The ID of the prompt group to update.
	 * @param updates Partial data to update the prompt. Cannot update id, userId. RevisionId is handled internally based on newVersion.
	 * @param userId The ID of the user owning the prompt.
	 * @param newVersion If true, creates a new revision; otherwise, updates the latest revision.
	 * @returns A promise that resolves to the updated (or newly created revision of the) Prompt object.
	 * @throws Error if the prompt is not found or user is not authorized.
	 */
	updatePrompt(promptId: string, updates: Partial<Omit<Prompt, 'id' | 'userId' | 'revisionId'>>, userId: string, newVersion: boolean): Promise<Prompt>;

	/**
	 * Deletes a prompt and all its revisions.
	 * @param promptId The ID of the prompt group to delete.
	 * @param userId The ID of the user owning the prompt.
	 * @returns A promise that resolves when the deletion is complete.
	 * @throws Error if the prompt is not found or user is not authorized.
	 */
	deletePrompt(promptId: string, userId: string): Promise<void>;
}
