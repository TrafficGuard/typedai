import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { type LlmMessage, messageText } from '#llm/llm';
import { logger } from '#o11y/logger';
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

		// Instantiate ApplySearchReplace once.
		// It will be used for both building the prompt and applying the edits.
		// filesToEdit are passed as initialFiles to set up the context.
		// Options for both prompt building and edit application are set here.
		const searchReplacer = new ApplySearchReplace(rootPath, filesToEdit, {
			editFormat,
			autoCommits: commit,
			dirtyCommits: true, 
			dryRun: false,
			lenientLeadingWhitespace: true, // <<< Add this line
			// language: 'typescript', 
			// suggestShellCommands: true, 
		});

		// repoMapContent could be fetched or passed if available, e.g., via fileSystem.generateRepoMap()
		const repoMapContent: string | undefined = undefined; // Or fetch if needed

		// Build the prompt using ApplySearchReplace instance.
		// additionalFilesToChatRelativePaths is empty because filesToEdit are already handled by initialFiles in constructor.
		const messages: LlmMessage[] = await searchReplacer.buildPrompt(requirements, filesToEdit, readOnlyFiles, repoMapContent);

		logger.debug({ messages }, 'SearchReplaceCoder: Prompt built for LLM');

		// Call the LLM
		const llmResponseMsg: LlmMessage = await llms().hard.generateMessage(messages, {
			id: 'SearchReplaceCoder.editFiles', // Unique ID for tracing/logging
			temperature: 0.0, // Low temperature for more deterministic code editing
			// stop: ['>>>>>>> REPLACE'], // Optional: if specific stop sequences are beneficial, though ApplySearchReplace should parse the whole block.
		});

		const llmResponseText = messageText(llmResponseMsg);

		// Pass empty string if llmResponseText is null/undefined to avoid errors in applyLlmResponse
		const responseToApply = llmResponseText || '';
		if (!llmResponseText?.trim()) {
			logger.warn('SearchReplaceCoder: LLM returned an empty or whitespace-only response.');
			// applyLlmResponse will likely find no edit blocks and return an empty set.
		}

		// Apply the edits using the same ApplySearchReplace instance
		const editedFiles: Set<string> | null = await searchReplacer.applyLlmResponse(responseToApply, llms().hard);

		if (editedFiles === null) {
			// A reflectedMessage should be set on the searchReplacer instance if applyLlmResponse returns null
			const reflection = searchReplacer.reflectedMessage || 'No specific reflection message provided.';
			logger.error({ reflectedMessage: reflection }, 'SearchReplaceCoder: Failed to apply edits. LLM reflection suggested.');
			// Throw an error to indicate failure that might require intervention or retry
			throw new Error(`Failed to apply edits. Reflection: ${reflection}`);
		}

		if (editedFiles.size === 0 && !searchReplacer.reflectedMessage) {
			logger.info('SearchReplaceCoder: No edits were applied by the LLM (or no valid edit blocks found in the response).');
		} else if (editedFiles.size > 0) {
			logger.info({ editedFiles: Array.from(editedFiles) }, 'SearchReplaceCoder: Successfully applied edits.');
		}
		// The 'commit' parameter is handled by the 'autoCommits' option passed to ApplySearchReplace.
	}
}
