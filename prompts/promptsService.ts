import type { Prompt, PromptPreview, CallSettings, LlmMessage } from '#shared/prompts/prompts.model';

export interface PromptsService {
	getPrompt(promptId: string, userId: string): Promise<Prompt | null>;

	getPromptVersion(promptId: string, revisionId: number, userId: string): Promise<Prompt | null>;

	listPromptsForUser(userId: string): Promise<PromptPreview[]>;

	createPrompt(promptData: Omit<Prompt, 'id' | 'revisionId' | 'userId'>, userId: string): Promise<Prompt>;

	updatePrompt(
		promptId: string,
		updates: Partial<Omit<Prompt, 'id' | 'userId' | 'revisionId'>>,
		userId: string,
		newVersion: boolean,
	): Promise<Prompt>;

	deletePrompt(promptId: string, userId: string): Promise<void>;
}
