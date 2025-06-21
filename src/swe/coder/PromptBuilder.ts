import type { LlmMessage } from '#shared/llm/llm.model';
import type { EditSession } from './state/EditSession';

/**
 * Responsible for constructing prompts for the LLM based on the coding task state.
 */
export class PromptBuilder {
	/**
	 * Builds the messages to be sent to the LLM for the next step in the coding task.
	 * @param session The current edit session, containing state like failed edits and reflections.
	 * @param existingMessages The conversation history with the LLM.
	 * @returns An array of LlmMessage objects ready to be sent to the LLM.
	 */
	public buildMessages(session: EditSession, existingMessages: LlmMessage[]): LlmMessage[] {
		// This is a placeholder implementation.
		// The actual logic will construct a detailed prompt, potentially including:
		// - System prompts
		// - The user's request
		// - Context files
		// - Reflections on previous failures
		// - The previous conversation history
		return existingMessages;
	}
}
