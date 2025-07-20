import path from 'node:path';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { ReasonerDebateLLM } from '#llm/multi-agent/reasoning-debate';
import { extractTag } from '#llm/responseParsers';
import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/files/files.model';
import {
	type GenerateTextWithJsonResponse,
	type LLM,
	type LlmMessage,
	ThinkingLevel,
	type UserContentExt,
	assistant,
	contentText,
	extractAttachments,
	messageText,
} from '#shared/llm/llm.model';
import { text, user } from '#shared/llm/llm.model';
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

function norm(p: string): string {
	return path.posix.normalize(p.trim().replace(/^\.\/+/, ''));
}

// Helper function to validate paths and return normalized valid paths
async function validateAndFilterPaths(rawPaths: string[], workingDir: string): Promise<{ validPaths: string[]; invalidPaths: string[] }> {
	const fs = getFileSystem();
	const validPaths: string[] = [];
	const invalidPaths: string[] = [];
	for (const rawPath of rawPaths) {
		if (!rawPath) continue; // Skip empty/null paths
		const normalizedPath = norm(rawPath);
		try {
			await fs.readFile(path.join(workingDir, normalizedPath));
			validPaths.push(normalizedPath); // Store normalized path
		} catch (e) {
			logger.info(`Path validation failed for ${rawPath} (normalized: ${normalizedPath}): ${(e as Error).message}`);
			invalidPaths.push(rawPath); // Store original raw path for reporting
		}
	}
	return { validPaths, invalidPaths };
}

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

export interface QueryOptions {
	/** Use the xtra hard LLM for the final answer if available */
	useXtraHardLLM?: boolean;
	projectInfo?: ProjectInfo;
	/** File paths which will be used as the initial file selection */
	initialFilePaths?: string[];
	/** Previously selected files which will be used as the initial file selection */
	initialFiles?: SelectedFile[];
}

export interface FileExtract {
	/** The file path */
	path: string;
	/** The extract of the file contents which is relevant to the task */
	extract: string;
}

export async function selectFilesAgent(requirements: UserContentExt, options: QueryOptions = {}): Promise<SelectedFile[]> {
	if (!requirements) throw new Error('Requirements must be provided');
	const { selectedFiles } = await selectFilesCore(requirements, options);
	return selectedFiles;
}

export async function queryWorkflowWithSearch(query: UserContentExt, opts: QueryOptions = {}): Promise<string> {
	if (!query) throw new Error('query must be provided');
	const { files, answer } = await queryWithFileSelection2(query, opts);
	return answer;
}

export async function queryWithFileSelection2(query: UserContentExt, opts: QueryOptions = {}): Promise<{ files: SelectedFile[]; answer: string }> {
	const { messages, selectedFiles } = await selectFilesCore(query, opts);

	// Construct the final prompt for answering the query
	const finalPrompt = `<query>
${contentText(query)}
</query>

Please provide a detailed answer to the query using the information from the available file contents, and including citations to the files where the relevant information was found.
Think systematically and methodically through the query, considering multiple options, then output your final reasoning and answer wrapped in <result></result> tags.`;

	messages.push({ role: 'user', content: finalPrompt });

	// Perform the additional LLM call to get the answer
	const xhard = llms().xhard;
	const llm: LLM = opts.useXtraHardLLM && xhard ? xhard : llms().hard;
	const thinking: ThinkingLevel = llm instanceof ReasonerDebateLLM ? 'none' : 'high';

	let answer = await llm.generateText(messages, { id: 'Select Files query Answer', thinking });
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
	opts: QueryOptions,
): Promise<{
	messages: LlmMessage[];
	selectedFiles: SelectedFile[];
}> {
	const messages: LlmMessage[] = await initializeFileSelectionAgent(requirements, opts);

	const maxIterations = 10;
	let iterationCount = 0;

	let llm = llms().medium;

	const response: GenerateTextWithJsonResponse<InitialResponse> = await llm.generateTextWithJson(messages, { id: 'Select Files initial', thinking: 'high' });
	logger.info(messageText(response.message));
	const initialResponse = response.object;
	messages.push({ role: 'assistant', content: JSON.stringify(initialResponse) });

	const initialRawInspectPaths = initialResponse.inspectFiles || [];
	const workingDir = getFileSystem().getWorkingDirectory();

	// Validate initial paths (Fix #5)
	const { validPaths: validatedInitialInspectPaths, invalidPaths: initiallyInvalidPaths } = await validateAndFilterPaths(initialRawInspectPaths, workingDir);

	// Use Maps to store kept/ignored files to ensure uniqueness by path
	const keptFiles = new Map<string, string>(); // path -> reason
	const ignoredFiles = new Map<string, string>(); // path -> reason
	const filesPendingDecision = new Set<string>();

	for (const validPath of validatedInitialInspectPaths) {
		filesPendingDecision.add(validPath); // Add normalized valid paths
	}
	// filesToInspect will carry the validated, normalized paths for content reading
	let filesToInspect = validatedInitialInspectPaths;
	let newInvalidPathsFromLastTurn: string[] = initiallyInvalidPaths; // For the first iteration message

	let usingHardLLM = false;

	while (true) {
		iterationCount++;
		if (iterationCount > maxIterations) {
			if (keptFiles.size > 0) {
				// Fix #3
				logger.warn('Maximum interaction iterations reached. Returning current selection.');
				break;
			}
			throw new Error('Maximum interaction iterations reached and no files selected.');
		}

		const response: IterationResponse = await generateFileSelectionProcessingResponse(
			messages,
			filesToInspect, // These are pre-validated, normalized paths
			filesPendingDecision,
			newInvalidPathsFromLastTurn, // Pass invalid paths from previous turn (Fix #5)
			iterationCount,
			llm,
		);
		console.log(response);

		// Process keep/ignore decisions first
		for (const ignored of response.ignoreFiles ?? []) {
			const path = typeof ignored === 'string' ? ignored : ignored?.filePath; // Handle both string and object responses
			if (!path) continue;
			const reason = typeof ignored === 'object' && ignored?.reason ? ignored.reason : 'Reason not provided by LLM.';
			const key = norm(path);
			ignoredFiles.set(key, reason);
			filesPendingDecision.delete(key);
		}
		const newlyKeptPaths: string[] = [];
		for (const kept of response.keepFiles ?? []) {
			const path = typeof kept === 'string' ? kept : kept?.filePath; // Handle both string and object responses
			if (!path) continue;
			const reason = typeof kept === 'object' && kept?.reason ? kept.reason : 'Reason not provided by LLM.';
			const key = norm(path);
			keptFiles.set(key, reason);
			filesPendingDecision.delete(key);
			newlyKeptPaths.push(key);
		}

		if (newlyKeptPaths.length) {
			try {
				const cwd = getFileSystem().getWorkingDirectory();
				const vcsRoot = getFileSystem().getVcsRoot();
				const alternativeFiles = await includeAlternativeAiToolFiles(newlyKeptPaths, { cwd, vcsRoot });
				for (const altFile of alternativeFiles) {
					if (!keptFiles.has(altFile) && !ignoredFiles.has(altFile)) {
						keptFiles.set(altFile, 'Relevant AI tool configuration/documentation file');
						logger.info(`Automatically included relevant AI tool file: ${altFile}`);
					}
				}
			} catch (error) {
				logger.warn(error, `Failed to check for or include alternative AI tool files based on: ${newlyKeptPaths.join(', ')}`);
			}
		}

		// Validate newly requested inspectFiles (Fix #5)
		const rawNewInspectPaths = response.inspectFiles ?? [];
		const { validPaths: validatedNewInspectPaths, invalidPaths: newlyInvalidPaths } = await validateAndFilterPaths(rawNewInspectPaths, workingDir);

		for (const validPath of validatedNewInspectPaths) {
			filesPendingDecision.add(validPath); // Add normalized valid paths
		}
		filesToInspect = validatedNewInspectPaths; // Update filesToInspect for the next iteration
		newInvalidPathsFromLastTurn = newlyInvalidPaths; // For the next call to generateFileSelectionProcessingResponse

		// If there are still pending files, but the LLM asked for no new action,
		// remind it and try another iteration instead of failing.
		if (filesPendingDecision.size > 0 && !response.search && filesToInspect.length === 0) {
			const pending = [...filesPendingDecision].join(', ');
			logger.warn(`LLM did not resolve pending files (${pending}). Asking again…`);

			messages.push({
				role: 'user',
				content: `You have not resolved the following pending files:\n${pending}
Please either:
 • move each of them to "keepFiles" or "ignoreFiles",
 • request them in "inspectFiles", or
 • perform a "search" that will help you decide.

Respond with a valid JSON object that follows the required schema.`,
			});

			// Escalate to the hard model once, to give the LLM more capacity.
			if (!usingHardLLM) {
				llm = llms().hard;
				usingHardLLM = true;
				logger.info('Escalating to hard LLM because of unresolved pending files.');
			}

			continue; // retry instead of throwing
		}

		if (response.search) {
			const searchRegex = response.search;
			const searchResultsText = await searchFileSystem(searchRegex);
			console.log('Search Results ==================');
			console.log(searchResultsText);
			console.log('End Search Results ==================');
			// The assistant message should reflect the actual response, including any keep/ignore/inspect decisions made alongside search.
			messages.push({ role: 'assistant', content: JSON.stringify(response) });
			messages.push({ role: 'user', content: searchResultsText, cache: 'ephemeral' });
			// filesToInspect was already updated with validated new inspectFiles. If search is also present,
			// LLM might have asked to inspect some files AND search.
			// If LLM uses search, it typically wouldn't inspect new files in the same turn, but the flexibility is there.
		} else {
			// This 'else' block handles the case where NO search was performed.
			// Keep/ignore/inspect decisions were already processed before the if(response.search).
			// We still need to push the assistant's response and potentially user messages with file contents.

			// If new files were requested for inspection (and validated into filesToInspect),
			// or if files were kept/ignored, this implies an action was taken.
			if (filesToInspect.length > 0 || (response.keepFiles ?? []).length > 0 || (response.ignoreFiles ?? []).length > 0) {
				// processedIterativeStepUserPrompt adds contents of KEPT files.
				// The contents for NEWLY INSPECTED files are added by generateFileSelectionProcessingResponse in the *next* turn.
				messages.push(await processedIterativeStepUserPrompt(response));
			}

			const cache = filesToInspect.length > 0 ? 'ephemeral' : undefined; // Ephemeral if new files are being inspected
			messages.push({
				role: 'assistant',
				content: JSON.stringify(response),
				cache,
			});

			const cachedMessages = messages.filter((msg) => msg.cache === 'ephemeral');
			if (cachedMessages.length > 4) {
				// This logic to remove 'ephemeral' status from older messages can be kept or revised.
				// For now, keeping it as is, as it's not the primary focus of the fixes.
				const firstEphemeralToClear = messages.find((msg, index) => {
					const originalIndex = messages.indexOf(cachedMessages[1]);
					return index === originalIndex;
				});
				if (firstEphemeralToClear) firstEphemeralToClear.cache = undefined;
			}
		}

		// LLM decision logic for switching to hard LLM or breaking
		// This logic applies whether a search was performed or not.
		// If a search was performed, filesToInspect might be empty (if LLM only searched),
		// or it might contain files if LLM searched AND asked to inspect some (uncommon but possible).
		if (filesToInspect.length === 0 && filesPendingDecision.size === 0) {
			// No new files to inspect, and all previously pending files decided.
			if (!usingHardLLM) {
				llm = llms().hard;
				usingHardLLM = true;
				logger.info('Switching to hard LLM for final review.');
			} else {
				logger.info('Hard LLM also decided not to inspect more files and no files are pending. Completing selection.');
				break;
			}
		} else if (filesToInspect.length === 0 && filesPendingDecision.size > 0) {
			// No new files requested for inspection, but some files are still pending.
			// Fix #2 (throw error) handles this if LLM doesn't request search or inspect.
			// This log remains useful if Fix #2 condition isn't met (e.g., LLM requests search).
			logger.warn(`LLM did not request new files to inspect, but ${filesPendingDecision.size} files are pending decision. Will proceed to next iteration.`);
		} else if (filesToInspect.length > 0) {
			// New files were requested for inspection (and validated into filesToInspect).
			logger.debug(`${filesToInspect.length} new files to inspect. Proceeding to next iteration.`);
		} else if (response.search) {
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

async function initializeFileSelectionAgent(requirements: UserContentExt, opts: QueryOptions): Promise<LlmMessage[]> {
	let projectInfo = opts.projectInfo;
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

	if (opts?.initialFiles?.length || opts.initialFilePaths?.length) {
		let fileContents = '';
		const keepAll: IterationResponse = {
			keepFiles: [],
		};
		if (opts.initialFiles) {
			const filePaths = opts.initialFiles.map((selection) => selection.filePath);
			fileContents = (await readFileContents(filePaths)).contents;
			keepAll.keepFiles.push(...opts.initialFiles);
		}
		if (opts.initialFilePaths) {
			fileContents += (await readFileContents(opts.initialFilePaths)).contents;
			keepAll.keepFiles.push(...opts.initialFilePaths.map((path) => ({ filePath: path, reason: 'previously selected' })));
		}
		messages.push(assistant(fileContents));
		messages.push(user(JSON.stringify(keepAll)));
	}

	return messages;
}

async function generateFileSelectionProcessingResponse(
	messages: LlmMessage[],
	filesToInspect: string[], // These are pre-validated, normalized paths
	pendingFiles: Set<string>, // Contains normalized, validated paths
	invalidPathsFromLastInspection: string[], // New parameter for Fix #5
	iteration: number,
	llm: LLM,
): Promise<IterationResponse> {
	// filesForContent are the files whose contents will be shown to the LLM in this turn.
	// These are the newly requested (and validated) filesToInspect.
	// If no new files are requested for inspection, but files are pending,
	// the prompt will still list all pendingFiles, but contents for them are not re-shown unless filesToInspect is empty.
	// The original logic was: const filesForContent = filesToInspect.length > 0 ? filesToInspect : Array.from(pendingFiles);
	// This could lead to re-showing all pending files. Let's stick to only showing newly inspected files.
	// The prompt will remind LLM about all pending files by listing their paths.
	const filesForContent = filesToInspect; // filesToInspect now contains only valid, newly requested files

	let prompt = '';

	if (invalidPathsFromLastInspection.length > 0) {
		prompt += `The following paths requested for inspection in the previous turn were invalid or unreadable and have been ignored: ${invalidPathsFromLastInspection.join(', ')}\n\n`;
	}

	if (filesForContent.length > 0) {
		prompt += `Contents of newly requested files for inspection:\n${(await readFileContents(filesForContent)).contents}\n`;
	}

	if (pendingFiles.size > 0) {
		prompt += `
The following files are currently pending your decision (some contents may have been provided in this turn or previous turns):
${Array.from(pendingFiles).join('\n')}
These files MUST be addressed by including them in either "keepFiles" or "ignoreFiles" in your response.`;
	} else {
		prompt += '\nNo files are currently pending decision. You can request to inspect new files, search, or complete the selection.';
	}

	prompt += `

You have the following actions available in your JSON response:
1.  **Decide on Pending/Inspected Files**:
    - "keepFiles": Array of {"filePath": "file/path", "reason": "why_essential"}. Only for files whose necessity is confirmed.
    - "ignoreFiles": Array of {"filePath": "file/path", "reason": "why_not_needed"}. For files previously inspected or considered but found non-essential.
    *All files listed above as pending MUST be included in either "keepFiles" or "ignoreFiles". This is crucial.*

2.  **Request to Inspect New Files**:
    - "inspectFiles": Array of ["path/to/new/file1", "path/to/new/file2"]. Use this if you need to see the content of specific new files. Do NOT use this if you are using "search" in the same response, unless you also have pending files to decide upon.

3.  **Search File Contents**:
    - "search": "your_regex_pattern_here". Use this if you need to find files based on their content.
    - The search results will be provided in the next turn.
    - *Important (Fix #4 clarification)*: If you use "search", you **must still** include "keepFiles" and "ignoreFiles" for any files currently pending decision.

**Workflow Strategy**:
- **Always prioritize deciding on all pending files.** Include them in "keepFiles" or "ignoreFiles".
- If more information is needed *after* deciding on all pending files:
    - If you know specific file paths, use "inspectFiles".
    - If you need to discover files based on content, use "search".
- You can use "inspectFiles" OR "search" in a single response to gather new information, but decisions on pending files are mandatory in every response that involves them.

Have you inspected enough files OR have enough information from searches to confidently determine the minimal essential set?
If yes, and all pending files are decided (i.e., 'pendingFiles' list above would be empty if this was the start of the turn), return empty arrays for "inspectFiles", no "search" property, and ensure "keepFiles" contains the final selection.

The final part of the response must be a JSON object in the following format:
<json>
{
  "keepFiles": [
    { "reason": "Clearly explains why this file is indispensable for the task.", "filePath": "path/to/essential/file1" }
  ],
  "ignoreFiles": [
    { "reason": "Explains why this file is not needed.", "filePath": "path/to/nonessential/file2" }
  ],
  "inspectFiles": ["path/to/new/file1", "path/to/new/file2"],
  "search": "regex search pattern if needed (optional)"
}
</json>
Only inspect files which are in the provided list.
You MUST responsd with a valid JSON object that follows the required schema inside <json></json> tags. Be carefuly to have the correct closing braces.
`;

	const iterationMessages: LlmMessage[] = [...messages, { role: 'user', content: prompt }];

	const response: GenerateTextWithJsonResponse<IterationResponse> = await llm.generateTextWithJson(iterationMessages, {
		id: `Select Files iteration ${iteration}`,
		thinking: 'high',
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
