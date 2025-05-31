import type { PromptsService } from '#prompts/promptsService';
import type { Prompt, PromptPreview } from '#shared/prompts/prompts.model';

export class MongoPromptsService implements PromptsService {
	constructor() {
		// TODO: Implement constructor
	}

	async getPrompt(promptId: string, userId: string): Promise<Prompt | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async getPromptVersion(promptId: string, revisionId: number, userId: string): Promise<Prompt | null> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async listPromptsForUser(userId: string): Promise<PromptPreview[]> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async createPrompt(promptData: Omit<Prompt, 'id' | 'revisionId' | 'userId'>, userId: string): Promise<Prompt> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async updatePrompt(promptId: string, updates: Partial<Omit<Prompt, 'id' | 'userId' | 'revisionId'>>, userId: string, newVersion: boolean): Promise<Prompt> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}

	async deletePrompt(promptId: string, userId: string): Promise<void> {
		// TODO: Implement method
		throw new Error('Method not implemented.');
	}
}
