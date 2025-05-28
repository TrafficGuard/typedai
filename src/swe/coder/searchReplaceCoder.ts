import { stringSimilarity } from 'string-similarity-js';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { type LlmMessage, user as createUserMessage, messageText } from '#shared/model/llm.model';
import { ApplySearchReplace, type EditBlock, type EditFormat, type FileEditBlocks } from '#swe/coder/applySearchReplace';

function sortEditBlocksByFilePath(edits: EditBlock[]) {
	const editsBlockByFilePath: FileEditBlocks = new Map();
	for (const edit of edits) {
		let edits: EditBlock[];
		if (!editsBlockByFilePath.has(edit.filePath)) {
			edits = [];
			editsBlockByFilePath.set(edit.filePath, edits);
		} else {
			edits = editsBlockByFilePath.get(edit.filePath);
		}
		edits.push(edit);
	}
	return editsBlockByFilePath;
}

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
			const edits = searchReplacer._findOriginalUpdateBlocks(responseToApply, searchReplacer.getFence());
			const editsBlockByFilePath = sortEditBlocksByFilePath(edits);
			const repoFiles = await fss.listFilesRecursively();

			// Use the static method for checking file paths
			let pathValidationReflection: string | null = null;
			for (const filePath of editsBlockByFilePath.keys()) {
				const errorMessage = SearchReplaceCoder.checkEditBlockFilePath(repoFiles, filePath);
				if (errorMessage) {
					pathValidationReflection = pathValidationReflection ? `${pathValidationReflection}\n${errorMessage}` : errorMessage;
				}
			}

			if (pathValidationReflection) {
				logger.warn({ reflection: pathValidationReflection }, `SearchReplaceCoder: File path validation failed for attempt ${attempts}.`);
				if (attempts >= maxAttempts) {
					throw new Error(`Failed due to file path validation errors after ${maxAttempts} attempts. Last error: ${pathValidationReflection}`);
				}
				currentMessages = [...currentMessages, createUserMessage(pathValidationReflection)];
				continue; // Next attempt
			}


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

	// Moved checkEditBlockFilePath here as a private static method
	private static SEP = '/'; // Assuming SEP is consistent, or use path.sep

	/**
	 * Sometimes the AI writes the file to the wrong place. If the edit block if for a filePath which doesn't currently exist,
	 * then make sure it's not too similar to an existing file path.
	 * If the file name and parent folder match an existing file and parent folder, then return a message for the AI to check the edit path.
	 * If file folder name starts with a module import alias (i.e. #), then return a message for the AI to check the edit path.
	 * @param filePaths All the file paths under the current working directory
	 * @param editBlockFilePath The file path of edits the AI has proposed
	 * @return null if the editBlockFilePath looks ok, else a message for the AI to check.
	 */
	private static checkEditBlockFilePath(filePaths: string[], editBlockFilePath: string): string | null {
		// const fss = getFileSystem(); // Not needed if filePaths is comprehensive

		if (filePaths.includes(editBlockFilePath)) {
			return null;
		}

		if (editBlockFilePath.startsWith('#') || editBlockFilePath.startsWith('@')) {
			return `File path "${editBlockFilePath}" should not begin with '${editBlockFilePath.charAt(0)}'. It seems like you're writing to a module alias. You need to write to a real file path.`;
		}

		// Check for similarity - this can be noisy, use with caution or refine threshold
		// for (const filePath of filePaths) {
		// 	if (stringSimilarity(filePath, editBlockFilePath) > 0.9) {
		// 		// return `The proposed file path '${editBlockFilePath}' is very similar to an existing file '${filePath}'. Please verify the path.`;
		// 	}
		// }

		const editParts = editBlockFilePath.split(SearchReplaceCoder.SEP);
		if (editParts.length >= 2) {
			const editFileName = editParts[editParts.length - 1];
			const editParentFolder = editParts[editParts.length - 2];

			for (const filePath of filePaths) {
				const existingFileParts = filePath.split(SearchReplaceCoder.SEP);
				if (existingFileParts.length >= 2) {
					const existingFileName = existingFileParts[existingFileParts.length - 1];
					const existingParentFolder = existingFileParts[existingFileParts.length - 2];

					if (editFileName === existingFileName && editParentFolder === existingParentFolder) {
						return `The proposed file path '${editBlockFilePath}' has a filename and parent folder that match an existing file '${filePath}'. Please verify the path.`;
					}
				}
			}
		}
		return null;
	}
}

// Remove the standalone checkEditBlockFilePath function from the bottom of the file.
