import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { type LlmMessage, user as createUserMessage, messageText } from '#shared/model/llm.model';
import { ApplySearchReplace, type EditBlock, type EditFormat, type FileEditBlocks } from '#swe/coder/applySearchReplace';
import { findOriginalUpdateBlocks } from './editBlockParser';
// import { stringSimilarity } from 'string-similarity-js'; // No longer used here, moved to SimilarFileNameRule

function sortEditBlocksByFilePath(edits: EditBlock[]) {
	const editsBlockByFilePath: FileEditBlocks = new Map();
	for (const edit of edits) {
		let editsArray: EditBlock[]; // Renamed to avoid conflict with outer 'edits'
		if (!editsBlockByFilePath.has(edit.filePath)) {
			editsArray = [];
			editsBlockByFilePath.set(edit.filePath, editsArray);
		} else {
			editsArray = editsBlockByFilePath.get(edit.filePath)!; // Added non-null assertion
		}
		editsArray.push(edit);
	}
	return editsBlockByFilePath;
}

// const SEP = '/'; // No longer used here, moved to SimilarFileNameRule

// checkEditBlockFilePath function is removed. Its logic is now in:
// - ModuleAliasRule
// - SimilarFileNameRule (for parent folder/name check and string similarity)
// - PathExistsRule (for new file with non-empty search block)

@funcClass(__filename)
export class SearchReplaceCoder {
	/**
	 * Makes the changes to the project files to meet the task requirements using search/replace blocks.
	 * @param requirements The complete task requirements with all supporting documentation and code samples.
	 * @param filesToEdit Relative paths of files that can be edited. These will be included in the chat context.
	 * @param readOnlyFiles Relative paths of files to be used as read-only context.
	 * @param commit Whether to commit the changes automatically after applying them.
	 * @param dirtyCommits If files which have uncommitted changes should be committed before applying changes.
	 */
	@func()
	async editFilesToMeetRequirements(requirements: string, filesToEdit: string[], readOnlyFiles: string[], commit = true, dirtyCommits = true): Promise<void> {
		const fileSystem = getFileSystem();
		const rootPath = fileSystem.getWorkingDirectory();
		const editFormat: EditFormat = 'diff-fenced';
		const fss = getFileSystem();

		logger.info({ requirements, filesToEdit, readOnlyFiles }, 'editFilesToMeetRequirements');

		const searchReplacer = new ApplySearchReplace(rootPath, filesToEdit, {
			editFormat,
			autoCommits: commit,
			dirtyCommits: dirtyCommits,
			dryRun: false,
			lenientLeadingWhitespace: true,
		});

		await searchReplacer.initializeDirtyFileTracking();

		const repoMapContent: string | undefined = undefined;

		let currentMessages: LlmMessage[] = await searchReplacer.buildPrompt(requirements, filesToEdit, readOnlyFiles, repoMapContent);
		logger.debug({ messages: currentMessages }, 'SearchReplaceCoder: Initial prompt built for LLM');

		let attempts = 0;
		const maxAttempts = 3;

		while (attempts < maxAttempts) {
			attempts++;
			logger.info(`SearchReplaceCoder: LLM call attempt ${attempts}/${maxAttempts}`);

			const llmResponseMsgObj: LlmMessage = await llms().hard.generateMessage(currentMessages, {
				id: `SearchReplaceCoder.editFiles.attempt${attempts}`,
				temperature: 0.0,
			});

			currentMessages = [...currentMessages, llmResponseMsgObj];
			const llmResponseText = messageText(llmResponseMsgObj);
			const responseToApply = llmResponseText || '';

			if (!llmResponseText?.trim() && attempts === 1) {
				logger.warn('SearchReplaceCoder: LLM returned an empty or whitespace-only response on first attempt.');
			}

			console.log(responseToApply);
			const edits = findOriginalUpdateBlocks(responseToApply, searchReplacer.getFence());
			const editsBlockByFilePath = sortEditBlocksByFilePath(edits);
			const repoFiles = await fss.listFilesRecursively();

			// TODO: Replace this with validateBlocks call in a future step (Step 5 of roadmap)
			// For now, the old validation logic is removed. The new validation rules exist but are not yet wired in here.
			// This means for this commit, the direct path validation that was here is temporarily gone.
			// It will be replaced by the new system in Step 5.

			// Old validation logic removed:
			// let pathValidationReflection: string | null = null;
			// for (const filePath of editsBlockByFilePath.keys()) {
			// 	const errorMessage = checkEditBlockFilePath(repoFiles, filePath); // This function is now removed
			// 	if (errorMessage) {
			// 		pathValidationReflection = pathValidationReflection ? `${pathValidationReflection}\n${errorMessage}` : errorMessage;
			// 	}
			// }
			//
			// if (pathValidationReflection) {
			// 	logger.warn({ reflection: pathValidationReflection }, `SearchReplaceCoder: File path validation failed for attempt ${attempts}.`);
			// 	if (attempts >= maxAttempts) {
			// 		throw new Error(`Failed due to file path validation errors after ${maxAttempts} attempts. Last error: ${pathValidationReflection}`);
			// 	}
			// 	currentMessages = [...currentMessages, createUserMessage(pathValidationReflection)];
			// 	continue; // Next attempt
			// }

			const editedFiles: Set<string> | null = await searchReplacer.applyLlmResponse(responseToApply, llms().hard);

			if (editedFiles !== null) {
				if (editedFiles.size === 0 && !searchReplacer.reflectedMessage) {
					logger.info('SearchReplaceCoder: No edits were applied by the LLM (or no valid edit blocks found in the response).');
				} else if (editedFiles.size > 0) {
					logger.info({ editedFiles: Array.from(editedFiles) }, 'SearchReplaceCoder: Successfully applied edits.');
				}
				return;
			}

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

			currentMessages = [...currentMessages, createUserMessage(reflection)];
		}
	}
}

// Moved checkEditBlockFilePath from being a static method to a module-level function above the class.
// No standalone checkEditBlockFilePath function was at the bottom of the file previously.
