import path from 'node:path';
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

/*
Agent which iteratively loads files to find the file set required for a task/query.

After each iteration the agent should accept or ignore each of the new files loaded.

This agent is designed to utilise LLM prompt caching
*/

// Constants for search result size management
const MAX_SEARCH_TOKENS = 8000; // Maximum tokens for search results
const APPROX_CHARS_PER_TOKEN = 4; // Approximate characters per token
const MAX_SEARCH_CHARS = MAX_SEARCH_TOKENS * APPROX_CHARS_PER_TOKEN; // Maximum characters for search results

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

export async function selectFilesAgent(requirements: UserContentExt, projectInfo?: ProjectInfo, options?: FileSelectionUpdate): Promise<SelectedFile[]> {
	if (!requirements) throw new Error('Requirements must be provided');
	const { selectedFiles } = await selectFilesCore(requirements, projectInfo, options);
	return selectedFiles;
}

export async function queryWorkflowWithSearch(query: UserContentExt, projectInfo?: ProjectInfo): Promise<string> {
	if (!query) throw new Error('query must be provided');
	const { files, answer } = await queryWithFileSelection2(query, projectInfo);
	return answer;
}

export async function queryWithFileSelection2(query: UserContentExt, projectInfo?: ProjectInfo): Promise<{ files: SelectedFile[]; answer: string }> {
	const { messages, selectedFiles } = await selectFilesCore(query, projectInfo);

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
	let answer = await llms().hard.generateText(messages, { id: 'Select Files query' });
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
): Promise<{
	messages: LlmMessage[];
	selectedFiles: SelectedFile[];
}> {
	const messages: LlmMessage[] = await initializeFileSelectionAgent(requirements, projectInfo, options);

	const maxIterations = 10;
	let iterationCount = 0;

	let llm = llms().medium;

	const response: GenerateTextWithJsonResponse<InitialResponse> = await llm.generateTextWithJson(messages, { id: 'Select Files initial' });
	logger.info(messageText(response.message));
	const initialResponse = response.object;
	messages.push({ role: 'assistant', content: JSON.stringify(initialResponse) });

	let filesToInspect = initialResponse.inspectFiles || [];

	// Use Maps to store kept/ignored files to ensure uniqueness by path
	const keptFiles = new Map<string, string>(); // path -> reason
	const ignoredFiles = new Map<string, string>(); // path -> reason
	const filesPendingDecision = new Set<string>(filesToInspect);

	let usingHardLLM = false;

	while (true) {
		iterationCount++;
		if (iterationCount > maxIterations) throw new Error('Maximum interaction iterations reached.');

		const response: IterationResponse = await generateFileSelectionProcessingResponse(messages, filesToInspect, filesPendingDecision, iterationCount, llm);
		console.log(response);

		if (response.search) {
			const searchRegex = response.search;
			const searchResultsText = await searchFileSystem(searchRegex);
			console.log('Search Results ==================');
			console.log(searchResultsText);
			console.log('End Search Results ==================');
			messages.push({ role: 'assistant', content: JSON.stringify({ search: searchRegex, inspectFiles: [], keepFiles: [], ignoreFiles: [] }) });
			messages.push({ role: 'user', content: searchResultsText, cache: 'ephemeral' });

			filesToInspect = []; // LLM will decide next action based on search results
		} else {
			// Existing logic for keepFiles, ignoreFiles, inspectFiles
			for (const ignored of response.ignoreFiles ?? []) {
				ignoredFiles.set(ignored.filePath, ignored.reason);
				filesPendingDecision.delete(ignored.filePath);
			}
			for (const kept of response.keepFiles ?? []) {
				keptFiles.set(kept.filePath, kept.reason);
				filesPendingDecision.delete(kept.filePath);
			}

			const justKeptPaths = response.keepFiles?.map((f) => f.filePath) ?? [];
			if (justKeptPaths.length > 0) {
				try {
					const cwd = getFileSystem().getWorkingDirectory();
					const vcsRoot = getFileSystem().getVcsRoot();
					const alternativeFiles = await includeAlternativeAiToolFiles(justKeptPaths, { cwd, vcsRoot });
					for (const altFile of alternativeFiles) {
						if (!keptFiles.has(altFile) && !ignoredFiles.has(altFile)) {
							keptFiles.set(altFile, 'Relevant AI tool configuration/documentation file');
							logger.info(`Automatically included relevant AI tool file: ${altFile}`);
						}
					}
				} catch (error) {
					logger.warn(error, `Failed to check for or include alternative AI tool files based on: ${justKeptPaths.join(', ')}`);
				}
			}

			if ((response.inspectFiles ?? []).length > 0 || (response.keepFiles ?? []).length > 0 || (response.ignoreFiles ?? []).length > 0) {
				messages.push(await processedIterativeStepUserPrompt(response));
			}

			const cache = (response.inspectFiles ?? []).length ? 'ephemeral' : undefined;
			messages.push({
				role: 'assistant',
				content: JSON.stringify(response),
				cache,
			});

			const cachedMessages = messages.filter((msg) => msg.cache === 'ephemeral');
			if (cachedMessages.length > 4) {
				cachedMessages[1].cache = undefined;
			}

			filesToInspect = response.inspectFiles ?? [];
			for (const fileToInspect of filesToInspect) {
				filesPendingDecision.add(fileToInspect);
			}
		}

		// LLM decision logic for switching to hard LLM or breaking
		if (!response.search) {
			if (filesToInspect.length === 0 && filesPendingDecision.size === 0) {
				if (!usingHardLLM) {
					llm = llms().hard;
					usingHardLLM = true;
					logger.info('Switching to hard LLM for final review.');
				} else {
					logger.info('Hard LLM also decided not to inspect more files. Completing selection.');
					break;
				}
			} else if (filesToInspect.length === 0 && filesPendingDecision.size > 0) {
				logger.warn(
					`LLM did not request new files to inspect, but ${filesPendingDecision.size} files are pending decision. Will proceed to next iteration for LLM to process pending files.`,
				);
			}
		} else {
			logger.debug('Search was performed. Proceeding to next iteration for LLM to process search results.');
		}
	}

	if (keptFiles.size === 0) throw new Error('No files were selected to fulfill the requirements.');

	const selectedFiles: SelectedFile[] = Array.from(keptFiles.entries()).map(([path, reason]) => ({
		filePath: path,
		reason,
		// readOnly property is not explicitly handled by the LLM response in this flow, default to undefined or false if needed
	}));

	return { messages, selectedFiles };
}

async function initializeFileSelectionAgent(requirements: UserContentExt, projectInfo?: ProjectInfo, options?: FileSelectionUpdate): Promise<LlmMessage[]> {
	projectInfo ??= (await detectProjectInfo())[0];

	const projectMaps: RepositoryMaps = await generateRepositoryMaps([projectInfo]);
	const repositoryOverview: string = await getRepositoryOverview();
	const fileSystemWithSummaries: string = `<project_files>\n${projectMaps.fileSystemTreeWithFileSummaries.text}\n</project_files>\n`;
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
	let prompt = '';

	if (filesToInspect.length) prompt = (await readFileContents(filesToInspect)).contents;

	if (filesToInspect.length || pendingFiles.size) {
		prompt += `
The files whose contents were provided in this turn (if any from 'inspectFiles' in the previous turn) or are still pending decision from earlier turns are:
${[...Array.from(pendingFiles), ...filesToInspect].filter(Boolean).join('\n')}
These files MUST be addressed by including them in either "keepFiles" or "ignoreFiles" in your response.`;
	} else {
		prompt +=
			'\nNo specific files were provided for direct inspection in this turn. Evaluate based on previous information, search results, or the project overview.';
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
	console.log(messageText(response.message));
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

async function readFileContents(filePaths: string[]): Promise<{ contents: string; invalidPaths: string[] }> {
	const fileSystem = getFileSystem();
	let contents = '<files>\n';

	const invalidPaths = [];

	for (const filePath of filePaths) {
		if (!filePath) continue;
		const fullPath = path.join(fileSystem.getWorkingDirectory(), filePath);
		try {
			const fileContent = await fileSystem.readFile(fullPath);
			contents += `<file_contents path="${filePath}">
${fileContent}
</file_contents>
`;
		} catch (e) {
			logger.info(`Couldn't read ${filePath}`);
			contents += `Invalid path ${filePath}\n`;
			invalidPaths.push(filePath);
		}
	}
	return { contents: `${contents}</files>`, invalidPaths };
}

async function searchFileSystem(searchRegex: string) {
	let searchResultsText = '';
	let searchPerformedSuccessfully = false;
	const fs = getFileSystem();

	try {
		logger.debug(`Attempting search with regex "${searchRegex}" and context 1`);
		const extractsC1 = await fs.searchExtractsMatchingContents(searchRegex, 1);
		if (extractsC1.length <= MAX_SEARCH_CHARS) {
			searchResultsText = `<search_results regex="${searchRegex}" context_lines="1">\n${extractsC1}\n</search_results>\n`;
			searchPerformedSuccessfully = true;
			logger.debug(`Search with context 1 succeeded, length: ${extractsC1.length}`);
		} else {
			logger.debug(`Search with context 1 too long: ${extractsC1.length} chars`);
		}
	} catch (e) {
		logger.warn(e, `Error during searchExtractsMatchingContents (context 1) for regex: ${searchRegex}`);
		searchResultsText = `<search_error regex="${searchRegex}" context_lines="1">\nError: ${e.message}\n</search_error>\n`;
	}

	if (!searchPerformedSuccessfully && !searchResultsText.includes('<search_error')) {
		try {
			logger.debug(`Attempting search with regex "${searchRegex}" and context 0`);
			const extractsC0 = await fs.searchExtractsMatchingContents(searchRegex, 0);
			if (extractsC0.length <= MAX_SEARCH_CHARS) {
				searchResultsText = `<search_results regex="${searchRegex}" context_lines="0">\n${extractsC0}\n</search_results>\n`;
				searchPerformedSuccessfully = true;
				logger.debug(`Search with context 0 succeeded, length: ${extractsC0.length}`);
			} else {
				logger.debug(`Search with context 0 too long: ${extractsC0.length} chars`);
			}
		} catch (e) {
			logger.warn(e, `Error during searchExtractsMatchingContents (context 0) for regex: ${searchRegex}`);
			searchResultsText = `<search_error regex="${searchRegex}" context_lines="0">\nError: ${e.message}\n</search_error>\n`;
		}
	}

	if (!searchPerformedSuccessfully && !searchResultsText.includes('<search_error')) {
		try {
			logger.debug(`Attempting search with regex "${searchRegex}" (file counts)`);
			let fileMatches = await fs.searchFilesMatchingContents(searchRegex);
			if (fileMatches.length <= MAX_SEARCH_CHARS) {
				searchResultsText = `<search_results regex="${searchRegex}" type="file_counts">\n${fileMatches}\n</search_results>\n`;
				searchPerformedSuccessfully = true;
				logger.debug(`Search with file_counts succeeded, length: ${fileMatches.length}`);
			} else {
				const originalLength = fileMatches.length;
				fileMatches = fileMatches.substring(0, MAX_SEARCH_CHARS);
				searchResultsText = `<search_results regex="${searchRegex}" type="file_counts" truncated="true" original_chars="${originalLength}" truncated_chars="${MAX_SEARCH_CHARS}">\n${fileMatches}\n</search_results>\nNote: Search results were too large (${originalLength} characters, estimated ${Math.ceil(originalLength / APPROX_CHARS_PER_TOKEN)} tokens) and have been truncated to ${MAX_SEARCH_CHARS} characters (estimated ${MAX_SEARCH_TOKENS} tokens). Please use a more specific search term if needed.\n`;
				searchPerformedSuccessfully = true;
				logger.debug(`Search with file_counts truncated, original_length: ${originalLength}, new_length: ${fileMatches.length}`);
			}
		} catch (e) {
			logger.warn(e, `Error during searchFilesMatchingContents for regex: ${searchRegex}`);
			searchResultsText = `<search_error regex="${searchRegex}" type="file_counts">\nError: ${e.message}\n</search_error>\n`;
		}
	}

	if (!searchPerformedSuccessfully && !searchResultsText.includes('<search_error')) {
		if (!searchResultsText) {
			// If no search was successful and no error was caught
			searchResultsText = `<search_results regex="${searchRegex}">\nNo results found or all attempts exceeded character limits.\n</search_results>\n`;
			logger.debug(`No search results for regex "${searchRegex}" or all attempts exceeded character limits.`);
		}
	}
	return searchResultsText;
}
