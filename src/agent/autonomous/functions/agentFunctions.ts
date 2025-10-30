import { agentContext } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';

export const AGENT_MEMORY = 'Agent_memory';

export const AGENT_COMPLETED_NAME = 'Agent_completed';

export const AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME = 'content';

export const AGENT_COMPLETED_PARAM_NAME = 'note';

/**
 * Functions for the agent to manage its memory and execution
 */
@funcClass(__filename)
export class Agent {
	/**
	 * Notifies that the user request has completed and there is no more work to be done, or that no more useful progress can be made with the functions.
	 * @param {string} note A detailed description that answers/completes the user request using Markdown formatting.
	 */
	@func()
	async completed(note: string): Promise<void> {
		await this.saveMemory('Agent_completed_note', note ?? '<none>', '');
		logger.info(`Agent completed. Note: ${note}`);
	}

	/**
	 * Stores content to your working memory, and continues on with the plan. You can assume the memory element now contains this key and content.
	 * @param {string} key A descriptive identifier (alphanumeric and underscores allowed, under 30 characters) for the new memory contents explaining the source of the content. This must not exist in the current memory.
	 * @param {string} content The plain text contents to store in the working memory
	 */
	// @func()
	async saveMemory(key: string, content: string, description: string): Promise<void> {
		if (!key || !key.trim().length) throw new Error('Memory key must be provided');
		if (!content || !content.trim().length) throw new Error('Memory content must be provided');
		const memory = agentContext()!.memory;
		if (memory[key]) logger.info(`Overwriting memory key ${key}`);
		memory[key] = content;
	}

	/**
	 * Updates existing content in your working memory, and continues on with the plan. You can assume the memory element now contains this key and content.
	 * Note this will over-write any existing memory content
	 * @param {string} key An existing key in the memory contents to update the contents of.
	 */
	// @func()
	async deleteMemory(key: string): Promise<void> {
		const memory = agentContext()!.memory;
		if (!memory[key]) logger.info(`deleteMemory key doesn't exist: ${key}`);
		delete memory[key];
	}

	/**
	 * Retrieves contents from memory
	 * @param {string} key An existing key in the memory to retrieve.
	 * @return {string} The memory contents
	 */
	// @func()
	async getMemory(key: string): Promise<string> {
		if (!key) throw new Error(`Parameter "key" must be provided. Was ${key}`);
		const memory = agentContext()!.memory;
		if (!memory[key]) throw new Error(`Memory key ${key} does not exist. Valid keys are ${Object.keys(memory).join(', ')}`);
		return memory[key];
	}

	/**
	 * Interacts with the memory entries
	 * @param operation 'SAVE', 'DELETE', or 'GET'
	 * @param key The memory key to save, delete, or get
	 * @param content The content to save to the memory (when operation is 'SAVE')
	 * @param description The description to save to the memory (when operation is 'SAVE')
	 * @returns void, or string when operation is 'GET'
	 */
	@func()
	async memory(operation: 'SAVE' | 'DELETE' | 'GET', key: string, content?: string, description?: string): Promise<undefined | string> {
		if (operation === 'SAVE') {
			if (!content) throw new Error('Content must be provided when saving memory');
			if (!key) throw new Error('Key must be provided when saving memory');
			// if (!description) throw new Error('Description must be provided when saving memory');
			await this.saveMemory(key, content, description ?? '');
			return undefined;
		}
		if (operation === 'DELETE') {
			await this.deleteMemory(key);
			return undefined;
		}
		if (operation === 'GET') {
			return this.getMemory(key);
		}
		throw new Error(`Invalid operation: ${operation}`);
	}
}
