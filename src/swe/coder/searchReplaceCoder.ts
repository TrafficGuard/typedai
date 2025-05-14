import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { type LlmMessage, user as createUserMessage, messageText } from '#shared/model/llm.model';
import { ApplySearchReplace, type EditFormat } from '#swe/coder/applySearchReplace';

@funcClass(__filename)
export class SearchReplaceCoder {
	/**
	 * Makes the changes to the project files to meet the task requirements using search/replace blocks.
	 * @param requirements The complete task requirements with all supporting documentation and code samples.
	 * @param filesToEdit Relative paths of files that can be edited. These will be included in the chat context.
	 * @param readOnlyFiles Relative paths of files to be used as read-only context.
	 * @param commit Whether to commit the changes automatically after applying them.
	 */
	@func()
	async editFilesToMeetRequirements(requirements: string, filesToEdit: string[], readOnlyFiles: string[], commit = true): Promise<void> {
		const fileSystem = getFileSystem();
		const rootPath = fileSystem.getWorkingDirectory();
		const editFormat: EditFormat = 'diff-fenced'; // A common format for AI code editing

		logger.info({ requirements, filesToEdit, readOnlyFiles }, 'editFilesToMeetRequirements');

		const searchReplacer = new ApplySearchReplace(rootPath, filesToEdit, {
			editFormat,
			autoCommits: commit,
			dirtyCommits: true,
			dryRun: false,
			lenientLeadingWhitespace: true,
		});

		const repoMapContent: string | undefined = undefined;

		let currentMessages: LlmMessage[] = await searchReplacer.buildPrompt(requirements, filesToEdit, readOnlyFiles, repoMapContent);
		logger.debug({ messages: currentMessages }, 'SearchReplaceCoder: Initial prompt built for LLM');

		let attempts = 0;
		const maxAttempts = 3; // Max reflection attempts

		while (attempts < maxAttempts) {
			attempts++;
			logger.info(`SearchReplaceCoder: LLM call attempt ${attempts}/${maxAttempts}`);

			const llmResponseMsgObj: LlmMessage = await llms().hard.generateMessage(currentMessages, {
				id: `SearchReplaceCoder.editFiles.attempt${attempts}`,
				temperature: 0.0,
			});

			// Add LLM's response to the message history for the next potential turn
			currentMessages = [...currentMessages, llmResponseMsgObj];

			const llmResponseText = messageText(llmResponseMsgObj);
			const responseToApply = llmResponseText || '';

			if (!llmResponseText?.trim() && attempts === 1) {
				// Only warn on first attempt for empty response
				logger.warn('SearchReplaceCoder: LLM returned an empty or whitespace-only response on first attempt.');
			}

			const editedFiles: Set<string> | null = await searchReplacer.applyLlmResponse(responseToApply, llms().hard);

			if (editedFiles !== null) {
				// Success or no edits but no reflection needed
				if (editedFiles.size === 0 && !searchReplacer.reflectedMessage) {
					logger.info('SearchReplaceCoder: No edits were applied by the LLM (or no valid edit blocks found in the response).');
				} else if (editedFiles.size > 0) {
					logger.info({ editedFiles: Array.from(editedFiles) }, 'SearchReplaceCoder: Successfully applied edits.');
				}
				return; // Exit loop on success
			}

			// If editedFiles is null, it means searchReplacer.reflectedMessage is (or should be) set
			const reflection = searchReplacer.reflectedMessage;
			if (!reflection) {
				logger.error('SearchReplaceCoder: applyLlmResponse returned null without a reflection message. Cannot proceed with reflection.');
				throw new Error('Edit application failed without specific reflection message, preventing retry.');
			}

			logger.warn({ reflectedMessage: reflection }, `SearchReplaceCoder: Edit attempt ${attempts} failed. Reflecting to LLM.`);

			if (attempts >= maxAttempts) {
				logger.error(`SearchReplaceCoder: Maximum reflection attempts (${maxAttempts}) reached. Failing.`);
				throw new Error(`Failed to apply edits after ${maxAttempts} attempts. Last reflection: ${reflection}`);
			}

			// Prepare for next attempt: add reflection to messages
			// The reflection message is formatted as if it's user feedback on the LLM's last attempt.
			currentMessages = [...currentMessages, createUserMessage(reflection)];
			// Note: llmResponseMsgObj (the assistant's failed attempt) is already in currentMessages.
		}
	}
}
