import { randomUUID } from 'node:crypto';
import type { PromptsService } from '#prompts/promptsService';
import type { Prompt, PromptPreview } from '#shared/prompts/prompts.model';

export class InMemoryPromptService implements PromptsService {
	// Storage for prompts: Map<promptGroupId, PromptRevisions[]>
	// Each Prompt array (revisions) should be sorted by revisionId ascending.
	private promptRevisions: Map<string, Prompt[]> = new Map();

	/**
	 * Helper method for deep copying a Prompt object.
	 * This ensures that the in-memory store is not mutated by external references.
	 */
	private _deepCopyPrompt(prompt: Prompt): Prompt {
		return JSON.parse(JSON.stringify(prompt));
	}

	/**
	 * Retrieves the latest revision of a specific prompt.
	 */
	async getPrompt(promptId: string, userId: string): Promise<Prompt | null> {
		const revisions = this.promptRevisions.get(promptId);
		if (!revisions || revisions.length === 0) {
			return null;
		}

		const latestRevision = revisions[revisions.length - 1]; // Assumes sorted by revisionId
		if (latestRevision.userId !== userId) {
			return null;
		}

		return this._deepCopyPrompt(latestRevision);
	}

	/**
	 * Retrieves a specific revision of a prompt.
	 */
	async getPromptVersion(promptId: string, revisionId: number, userId: string): Promise<Prompt | null> {
		const revisions = this.promptRevisions.get(promptId);
		if (!revisions) {
			return null;
		}

		const promptVersion = revisions.find((p) => p.revisionId === revisionId);
		if (!promptVersion || promptVersion.userId !== userId) {
			return null;
		}

		return this._deepCopyPrompt(promptVersion);
	}

	/**
	 * Lists all prompts (latest revisions) for a given user, returning previews.
	 */
	async listPromptsForUser(userId: string): Promise<PromptPreview[]> {
		const previews: PromptPreview[] = [];
		for (const revisions of this.promptRevisions.values()) {
			if (revisions.length === 0) {
				continue;
			}
			const latestRevision = revisions[revisions.length - 1]; // Assumes sorted
			if (latestRevision.userId === userId) {
				const { messages, ...previewData } = latestRevision;
				const preview: PromptPreview = { ...previewData };
				previews.push(preview);
			}
		}
		return previews;
	}

	/**
	 * Creates a new prompt.
	 */
	async createPrompt(promptData: Omit<Prompt, 'id' | 'revisionId' | 'userId'>, userId: string): Promise<Prompt> {
		const promptGroupId = randomUUID();
		const newPromptRevision: Prompt = {
			id: promptGroupId,
			userId: userId,
			revisionId: 1,
			name: promptData.name,
			parentId: promptData.parentId,
			appId: promptData.appId,
			tags: [...promptData.tags], // Deep copy of tags array
			messages: JSON.parse(JSON.stringify(promptData.messages)), // Deep copy of messages array
			settings: { ...promptData.settings }, // Shallow copy of options object
		};

		this.promptRevisions.set(promptGroupId, [newPromptRevision]);
		return this._deepCopyPrompt(newPromptRevision);
	}

	/**
	 * Updates an existing prompt.
	 */
	async updatePrompt(promptId: string, updates: Partial<Omit<Prompt, 'id' | 'userId' | 'revisionId'>>, userId: string, newVersion: boolean): Promise<Prompt> {
		const revisions = this.promptRevisions.get(promptId);
		if (!revisions || revisions.length === 0) {
			throw new Error(`Prompt with ID ${promptId} not found.`);
		}

		const latestRevisionInArray = revisions[revisions.length - 1];
		if (latestRevisionInArray.userId !== userId) {
			throw new Error('User not authorized to update this prompt.');
		}

		if (newVersion) {
			const newRevision = this._deepCopyPrompt(latestRevisionInArray); // Deep copy base

			// Apply updates
			newRevision.name = updates.name ?? newRevision.name;
			// For optional fields, allow setting to null if provided, otherwise keep existing
			if (updates.parentId !== undefined) newRevision.parentId = updates.parentId;
			if (updates.appId !== undefined) newRevision.appId = updates.appId;

			if (updates.tags) newRevision.tags = [...updates.tags];
			if (updates.messages) newRevision.messages = JSON.parse(JSON.stringify(updates.messages));
			if (updates.settings) newRevision.settings = { ...updates.settings }; // Shallow copy of new options

			newRevision.revisionId = latestRevisionInArray.revisionId + 1;
			revisions.push(newRevision); // Add to the existing array of revisions
			return this._deepCopyPrompt(newRevision);
		}
		// Update the latest revision in place
		const targetRevision = latestRevisionInArray;

		targetRevision.name = updates.name ?? targetRevision.name;
		// For optional fields, allow setting to null if provided, otherwise keep existing
		if (updates.parentId !== undefined) targetRevision.parentId = updates.parentId;
		if (updates.appId !== undefined) targetRevision.appId = updates.appId;

		if (updates.tags) targetRevision.tags = [...updates.tags];
		if (updates.messages) targetRevision.messages = JSON.parse(JSON.stringify(updates.messages));
		if (updates.settings) targetRevision.settings = { ...updates.settings }; // Shallow copy of new options

		// No change to revisionId, object already in map is mutated
		return this._deepCopyPrompt(targetRevision);
	}

	/**
	 * Deletes a prompt and all its revisions.
	 */
	async deletePrompt(promptId: string, userId: string): Promise<void> {
		const revisions = this.promptRevisions.get(promptId);

		if (revisions && revisions.length > 0) {
			const latestRevision = revisions[revisions.length - 1]; // Assumes sorted
			if (latestRevision.userId === userId) {
				this.promptRevisions.delete(promptId);
			} else {
				throw new Error('User not authorized to delete this prompt.');
			}
		} else {
			// This covers cases where promptId is not in the map,
			// or it's in the map but with an empty array of revisions (which shouldn't normally happen).
			throw new Error(`Prompt with ID ${promptId} not found.`);
		}
	}
}
