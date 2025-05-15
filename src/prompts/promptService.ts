export interface PromptsService {
	/** Lists the prompts for a user */
	listPrompts(userId: string): Promise<[]>;
}
