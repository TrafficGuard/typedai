import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { extractTag } from '#llm/responseParsers';
import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/model/files.model';
import {
	type GenerateTextWithJsonResponse,
	type LLM,
	type LlmMessage,
	type UserContentExt,
	assistant,
	contentText,
	extractAttachments,
	messageText,
} from '#shared/model/llm.model';
import { text, user } from '#shared/model/llm.model';
import { includeAlternativeAiToolFiles } from '#swe/includeAlternativeAiToolFiles';
import { getRepositoryOverview } from '#swe/index/repoIndexDocBuilder';
import { type RepositoryMaps, generateRepositoryMaps } from '#swe/index/repositoryMap';
import { type ProjectInfo, detectProjectInfo } from '#swe/projectDetection';
import {
	FAST_TARGET_CHARS,
	normalizePath as norm,
	readFileContents,
	searchFileSystem,
	splitFileSystemTreeByFolder,
} from './fastSelectFilesAgent.utils';

/*
Agent which iteratively loads files to find the file set required for a task/query.

After each iteration the agent should accept or ignore each of the new files loaded.

This agent is designed to utilise LLM prompt caching
*/

interface InitialResponse {
	inspectFiles?: string[];
}

interface IterationResponse {
	keepFiles?: SelectedFile[];
	ignoreFiles?: SelectedFile[];
	inspectFiles?: string[];
	search?: string; // Regex string for searching file contents
}

/**
 * When a user wants to continue on previous file selection, this provides the original file selection and the instructions on what needs to change in the file selection.
 */
export interface FileSelectionUpdate {
	currentFiles?: SelectedFile[];
	updatePrompt?: string;
}

export interface FileExtract {
	/** The file path */
	path: string;
	/** The extract of the file contents which is relevant to the task */
	extract: string;
}

interface SelectionState {
	kept: Map<string, string>; // path -> reason
	ignored: Map<string, string>; // path -> reason
	pending: Set<string>; // path
	resetPending(paths: string[]): void;
	markKept(file: SelectedFile): void;
	markIgnored(file: SelectedFile): void;
	hasUndecided(): boolean;
}

function createSelectionState(initialPendingPaths: string[] = []): SelectionState {
	const state: SelectionState = {
		kept: new Map<string, string>(),
		ignored: new Map<string, string>(),
		pending: new Set<string>(initialPendingPaths),
		resetPending(paths: string[]): void {
			state.pending.clear();
			for (const p of paths) {
				state.pending.add(norm(p));
			}
		},
		markKept(file: SelectedFile): void {
			const key = norm(file.filePath);
			state.kept.set(key, file.reason);
			state.pending.delete(key);
		},
		markIgnored(file: SelectedFile): void {
			const key = norm(file.filePath);
			state.ignored.set(key, file.reason);
			state.pending.delete(key);
		},
		hasUndecided(): boolean {
			return state.pending.size > 0;
		},
	};
	return state;
}

function shouldSwitchToHardLLM(filesToInspect: string[], state: SelectionState, usingHard: boolean): boolean {
	return filesToInspect.length === 0 && !state.hasUndecided() && !usingHard;
}

export async function fastSelectFilesAgent(
	requirements: UserContentExt,
	projectInfo?: ProjectInfo,
	options?: FileSelectionUpdate,
	providers: { medium: LLM; hard: LLM } = llms(),
): Promise<SelectedFile[]> {
	if (!requirements) throw new Error('Requirements must be provided');
	const { selectedFiles } = await selectFilesCore(requirements, projectInfo, options, providers);
	return selectedFiles;
}

export async function fastQueryWorkflow(
	query: UserContentExt,
	projectInfo?: ProjectInfo,
	providers: { medium: LLM; hard: LLM } = llms(),
): Promise<string> {
	if (!query) throw new Error('query must be provided');
	const { files, answer } = await fastQueryWithFileSelection(query, projectInfo, providers);
	return answer;
}

export async function fastQueryWithFileSelection(
	query: UserContentExt,
	projectInfo?: ProjectInfo,
	providers: { medium: LLM; hard: LLM } = llms(),
): Promise<{ files: SelectedFile[]; answer: string }> {
	const { messages, selectedFiles } = await selectFilesCore(query, projectInfo, undefined, providers);

	// Construct the final prompt for answering the query
	const finalPrompt = `<query>
${contentText(query)}
</query>

Please provide a detailed answer to the query using the information from the available file contents, and including citations to the files where the relevant information was found.
Respond in the following structure, with the answer in Markdown format inside the result tags  (Note only the contents of the result tag will be returned to the user):

<think></think>
<reflection></reflection>
<result></result>                                                                                                                                                                                                                                                                                 
 `;

	messages.push({ role: 'user', content: finalPrompt });

	// Perform the additional LLM call to get the answer
	let answer = await providers.hard.generateText(messages, { id: 'Select Files query', thinking: 'high' });
	try {
		answer = extractTag(answer, 'result');
	} catch {}

	return { answer: answer.trim(), files: selectedFiles };
}

/**
 *
 * The repository maps have summaries of each file and folder.
 * For a large project the long summaries for each file may be too long.
 *
 * At each iteration the agent can:
 * - Request the summaries for a subset of folders of interest, when needing to explore a particular section of the repository
 * - Search the repository (or a sub-folder) for file contents matching a regex
 * OR
 * - Inspect the contents of file(s), providing their paths
 * OR (must if previously inspected files)
 * - Add an inspected file to the file selection.
 * - Ignore an inspected file if it's not relevant.
 * OR
 * - Complete with the current selection
 *
 * i.e. The possible actions are:
 * 1. Search for files
 * 2. Inspect files
 * 3. Add/ignore inspected files
 * 4. Complete
 *
 * where #3 must always follow #2.
 *
 * To maximize caching input tokens to the LLM, new messages will be added to the previous messages with the results of the actions.
 * This should reduce cost and latency compared to using the dynamic autonomous agents to perform the task. (However that might change if we get the caching autonomous agent working)
 *
 * Example:
 * [index] - [role]: [message]
 *
 * Messages #1
 * 0 - SYSTEM/USER : given <task> and <filesystem-tree> and <repository-overview> select initial files for the task.
 *
 * Messages #2
 * 1 - ASSISTANT: { "inspectFiles": ["file1", "file2"] }
 * 0 - USER : given <task> and <filesystem-tree> and <repository-overview> select initial files for the task.
 *
 * Messages #3
 * 2 - USER: <file_contents path="file1"></file_contents><file_contents path="file2"></file_contents>. Respond with select/ignore
 * 1 - ASSISTANT: { "inspectFiles": ["file1", "file2"]}]}
 * 0 - USER : given <task> and <filesystem-tree> and <repository-overview> select initial files for the task.
 *
 * Messages #4
 * 3 - ASSISTANT: { "selectFiles": [{"filePath":"file1", "reason":"contains key details"], "ignoreFiles": [{"filePath":"file2", "reason": "did not contain the config"}] }
 * 2 - USER: <file_contents path="file1"></file_contents><file_contents path="file2"></file_contents>
 * 1 - ASSISTANT: { "inspectFiles": ["file1", "file2"] }
 * 0 - USER : given <task> and <filesystem-tree> and <repository-overview> select initial files for the task.
 *
 * Messages #5
 * 3 - ASSISTANT: { "selectFiles": [{"filePath":"file1", "reason":"contains key details"], "ignoreFiles": [{"filePath":"file2", "reason": "did not contain the config"}] }
 * 2 - USER: <file_contents path="file1"></file_contents><file_contents path="file2"></file_contents>
 * 1 - ASSISTANT: { "inspectFiles": ["file1", "file2"] }
 * 0 - USER : given <task> and <filesystem-tree> and <repository-overview> select initial files for the task.
 *
 *
 * The history of the actions will be kept, and always included in final message to the LLM.
 *
 * All files staged in a previous step must be processed in the next step (ie. added, extracted or removed)
 *
 * @param requirements
 * @param projectInfo
 */
async function selectFilesCore(
	requirements: UserContentExt,
	projectInfo?: ProjectInfo,
	options?: FileSelectionUpdate,
	providers: { medium: LLM; hard: LLM } = llms(),
): Promise<{
	messages: LlmMessage[];
	selectedFiles: SelectedFile[];
}> {
	const messages: LlmMessage[] = await initializeFileSelectionAgent(requirements, projectInfo, options);

	const maxIterations = 10;
	let iterationCount = 0;

	let llm = providers.medium;
	let usingHardLLM = false;

	const initialLlmResponse: GenerateTextWithJsonResponse<InitialResponse> = await llm.generateTextWithJson(messages, { id: 'Select Files initial' });
	logger.info(messageText(initialLlmResponse.message));
	const initialResponseObject = initialLlmResponse.object;
	messages.push({ role: 'assistant', content: JSON.stringify(initialResponseObject) });

	const initialRawInspectPaths = initialResponseObject.inspectFiles || [];
	const state = createSelectionState(initialRawInspectPaths.map(norm));
	let filesToInspect = initialRawInspectPaths; // Contains raw paths for readFileContents

	while (true) {
		iterationCount++;
		if (iterationCount > maxIterations) throw new Error('Maximum interaction iterations reached.');

		const currentIterationResponse: IterationResponse = await generateFileSelectionProcessingResponse(
			messages,
			filesToInspect,
			state.pending,
			iterationCount,
			llm,
		);
		logger.debug(currentIterationResponse);

		if (currentIterationResponse.search) {
			const searchRegex = currentIterationResponse.search;
			const searchResultsText = await searchFileSystem(searchRegex);
			logger.debug('Search Results ==================');
			logger.debug(searchResultsText);
			logger.debug('End Search Results ==================');
			messages.push({
				role: 'assistant',
				content: JSON.stringify({ search: searchRegex, inspectFiles: [], keepFiles: [], ignoreFiles: [] }),
			});
			messages.push({ role: 'user', content: searchResultsText, cache: 'ephemeral' });

			filesToInspect = []; // LLM will decide next action based on search results
			state.resetPending([]); // Clear pending as search results will guide next inspection
		} else {
			// Existing logic for keepFiles, ignoreFiles, inspectFiles
			for (const ignored of currentIterationResponse.ignoreFiles ?? []) {
				state.markIgnored(ignored);
			}
			for (const kept of currentIterationResponse.keepFiles ?? []) {
				state.markKept(kept);
			}

			const justKeptPaths = currentIterationResponse.keepFiles?.map((f) => norm(f.filePath)) ?? [];
			if (justKeptPaths.length > 0) {
				try {
					const cwd = getFileSystem().getWorkingDirectory();
					const vcsRoot = getFileSystem().getVcsRoot();
					const alternativeFiles = await includeAlternativeAiToolFiles(justKeptPaths, { cwd, vcsRoot });
					for (const altFile of alternativeFiles) {
						const altFilePath = norm(altFile);
						if (!state.kept.has(altFilePath) && !state.ignored.has(altFilePath)) {
							state.markKept({ filePath: altFilePath, reason: 'Relevant AI tool configuration/documentation file' });
							logger.info(`Automatically included relevant AI tool file: ${altFilePath}`);
						}
					}
				} catch (error) {
					logger.warn(error, `Failed to check for or include alternative AI tool files based on: ${justKeptPaths.join(', ')}`);
				}
			}

			if (
				(currentIterationResponse.inspectFiles ?? []).length > 0 ||
				(currentIterationResponse.keepFiles ?? []).length > 0 ||
				(currentIterationResponse.ignoreFiles ?? []).length > 0
			) {
				messages.push(await processedIterativeStepUserPrompt(currentIterationResponse));
			}

			const cache = (currentIterationResponse.inspectFiles ?? []).length ? 'ephemeral' : undefined;
			messages.push({
				role: 'assistant',
				content: JSON.stringify(currentIterationResponse),
				cache,
			});

			const cachedMessages = messages.filter((msg) => msg.cache === 'ephemeral');
			if (cachedMessages.length > 4) {
				// Keep the last 3 ephemeral messages, plus the initial assistant "What is my task?"
				// This means if there are 5, the 2nd one (index 1, after "What is my task?") becomes non-ephemeral.
				if (cachedMessages.length > 1) cachedMessages[1].cache = undefined;
			}

			const rawNewInspectPaths = currentIterationResponse.inspectFiles ?? [];
			state.resetPending(rawNewInspectPaths); // Reset pending to only the newly requested inspect files
			filesToInspect = rawNewInspectPaths; // Update filesToInspect for the next iteration's readFileContents
		}

		// LLM decision logic for switching to hard LLM or breaking
		if (!currentIterationResponse.search) {
			if (shouldSwitchToHardLLM(filesToInspect, state, usingHardLLM)) {
				llm = providers.hard;
				usingHardLLM = true;
				logger.info('Switching to hard LLM for final review.');
				continue; // Re-enter loop with hard LLM for one more pass
			}

			if (filesToInspect.length === 0 && !state.hasUndecided()) {
				// If not switching to hard LLM (either already using or condition not met) and no more actions
				logger.info('No new files to inspect and all pending files decided. Completing selection.');
				break;
			} else if (filesToInspect.length === 0 && state.hasUndecided()) {
				logger.warn(
					`LLM did not request new files to inspect, but ${state.pending.size} files are pending decision. Will proceed to next iteration for LLM to process pending files.`,
				);
			}
		} else {
			logger.debug('Search was performed. Proceeding to next iteration for LLM to process search results.');
		}
	}

	if (state.kept.size === 0) throw new Error('No files were selected to fulfill the requirements.');

	const selectedFilesOutput: SelectedFile[] = Array.from(state.kept.entries()).map(([path, reason]) => ({
		filePath: path,
		reason,
	}));

	return { messages, selectedFiles: selectedFilesOutput };
}

async function initializeFileSelectionAgent(requirements: UserContentExt, projectInfo?: ProjectInfo, options?: FileSelectionUpdate): Promise<LlmMessage[]> {
	projectInfo ??= (await detectProjectInfo())[0];

	const projectMaps: RepositoryMaps = await generateRepositoryMaps([projectInfo]);
	const repositoryOverview: string = await getRepositoryOverview();
	// Split the file-system tree into folder-level chunks so the first request
	// always fits within the FAST_MAX_TOKENS budget.  The LLM can later ask for
	// more context via inspect/search on specific folders or files.
	const treeChunks = splitFileSystemTreeByFolder(projectMaps.fileSystemTreeWithFileSummaries.text, FAST_TARGET_CHARS);
	const fileSystemWithSummaries: string = `<project_files chunk="1/${treeChunks.length}">\n${treeChunks[0]}\n</project_files>\n`;
	const repoOutlineUserPrompt = `${repositoryOverview}${fileSystemWithSummaries}`;

	const attachments = extractAttachments(requirements);

	const messages: LlmMessage[] = [
		// Have a separate message for repoOutlineUserPrompt for context caching
		{ role: 'user', content: repoOutlineUserPrompt },
		{ role: 'assistant', content: 'What is my task?', cache: 'ephemeral' },
	];

	// --- Initial Selection Prompt ---
	// Do not include file contents unless they have been provided to you.
	const userPromptText = `<requirements>\n${contentText(requirements)}\n</requirements>

Your task is to select the minimal set of files which are essential for completing the task/query described in the requirements, using the provided <project_files>.
**Focus intensely on necessity.** Only select a file if you are confident its contents are **directly required** to understand the context or make the necessary changes.
Avoid selecting files that are only tangentially related or provide general context unless strictly necessary for the core task.

Do not select package manager lock files as they are too large.

For this initial file selection step, identify the files you need to **inspect** first to confirm their necessity. Respond in the following format:
<think>
<!-- Rigorous thinking process justifying why each potential file is essential for the requirements. Question if each file is truly needed. -->
</think>
<json>
{
  "inspectFiles": [
  	"path/to/essential/file1",
	"path/to/another/crucial/file2"
  ]
}
</json>
`;
	messages.push(user([text(userPromptText), ...attachments], true));

	// Construct the initial prompt based on whether it's an initial selection or an update
	// Work in progress, may need to do this differently
	// Need to write unit tests for it
	if (options?.currentFiles) {
		const filePaths = options.currentFiles.map((selection) => selection.filePath);
		const fileContents = (await readFileContents(filePaths)).contents;
		messages.push(assistant(fileContents));
		const keepAll: IterationResponse = {
			keepFiles: options.currentFiles,
		};
		messages.push(user(JSON.stringify(keepAll)));
	}

	return messages;
}

async function generateFileSelectionProcessingResponse(
	messages: LlmMessage[],
	filesToInspect: string[],
	pendingFiles: Set<string>,
	iteration: number,
	llm: LLM,
): Promise<IterationResponse> {
	const filesForContent = filesToInspect.length > 0 ? filesToInspect : Array.from(pendingFiles);

	let prompt = '';
	if (filesForContent.length) {
		prompt = (await readFileContents(filesForContent)).contents;
	}

	if (pendingFiles.size) {
		prompt += `
The files whose contents were provided in this turn (if any, corresponding to paths listed below) or are still pending decision from earlier turns are:
${Array.from(pendingFiles).join('\n')}
These files MUST be addressed by including them in either "keepFiles" or "ignoreFiles" in your response.`;
	} else {
		prompt +=
			'\nNo specific files were provided for direct inspection in this turn, and no files are pending decision. Evaluate based on previous information, search results, or the project overview.';
	}

	prompt += `

You have the following actions available in your JSON response:
1.  **Decide on Pending/Inspected Files**:
    - "keepFiles": Array of {"filePath": "file/path", "reason": "why_essential"}. Only for files whose necessity is confirmed.
    - "ignoreFiles": Array of {"filePath": "file/path", "reason": "why_not_needed"}. For files previously inspected or considered but found non-essential.
    *All files listed above as pending or provided for inspection MUST be included in either "keepFiles" or "ignoreFiles".*

2.  **Request to Inspect New Files**:
    - "inspectFiles": Array of ["path/to/new/file1", "path/to/new/file2"]. Use this if you need to see the content of specific new files identified from the project structure or previous search results. Only request if you have a strong, specific reason. Do NOT use this if you are using "search".

3.  **Search File Contents**:
    - "search": "your_regex_pattern_here". Use this if you need to find files based on their content and the existing information (project files, summaries, previous search results) is insufficient.
    - The search results will be provided in the next turn. You can then decide to inspect files from those search results. Do NOT use this if you are using "inspectFiles".

**Workflow Strategy**:
- Prioritize deciding on any files whose contents you've already seen or that are pending decision.
- If more information is needed:
    - If you know the specific file paths, use "inspectFiles".
    - If you need to discover files based on content, use "search".
- You can use "inspectFiles" OR "search" in a single response, but not both. If "search" is used, you will evaluate its results in the next turn.
- If you have files to keep/ignore from previous steps, always include those decisions alongside any "inspectFiles" or "search" request.

Have you inspected enough files OR have enough information from searches to confidently determine the minimal essential set?
If yes, and all pending files are decided, return empty arrays for "inspectFiles", no "search" property, and ensure "keepFiles" contains the final selection.

The final part of the response must be a JSON object in the following format:
<json>
{
  "keepFiles": [
    {"filePath": "path/to/essential/file1", "reason": "Clearly explains why this file is indispensable for the task."}
  ],
  "ignoreFiles": [
    {"filePath": "path/to/nonessential/file2", "reason": "Explains why this file is not needed."}
  ],
  "inspectFiles": [], // Optional: new files to inspect. Mutually exclusive with "search".
  "search": "" // Optional: regex to search file contents. Mutually exclusive with "inspectFiles".
}
</json>
`;

	const iterationMessages: LlmMessage[] = [...messages, { role: 'user', content: prompt }];

	const response: GenerateTextWithJsonResponse<IterationResponse> = await llm.generateTextWithJson(iterationMessages, {
		id: `Select Files iteration ${iteration}`,
	});
	logger.info(messageText(response.message));
	return response.object;
}

/**
 * Generates the user message that we will add to the conversation, which includes the file contents the LLM wishes to inspect
 * @param response
 */
async function processedIterativeStepUserPrompt(response: IterationResponse): Promise<LlmMessage> {
	const ignored = response.ignoreFiles?.map((s) => s.filePath) ?? [];
	const kept = response.keepFiles?.map((s) => s.filePath) ?? [];

	let ignoreText = '';
	if (ignored.length) {
		ignoreText = '\nRemoved the following ignored files:';
		for (const ig of response.ignoreFiles) {
			ignoreText += `\n${ig.filePath} - ${ig.reason}`;
		}
	}

	return {
		role: 'user',
		content: `${(await readFileContents(kept)).contents}${ignoreText}`,
	};
}

