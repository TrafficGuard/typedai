import path from 'node:path';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import type { LLM, LlmMessage } from '#llm/llm';
import { extractTag } from '#llm/responseParsers';
import { openAIo3mini } from '#llm/services/openai';
import { logger } from '#o11y/logger';
import { getRepositoryOverview } from '#swe/index/repoIndexDocBuilder';
import { type RepositoryMaps, generateRepositoryMaps } from '#swe/index/repositoryMap';
import { type ProjectInfo, detectProjectInfo } from '#swe/projectDetection';

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
}

export interface SelectedFile {
	/** The file path */
	path: string;
	/** The reason why this file needs to in the file selection */
	reason: string;
	/** If the file should not need to be modified when implementing the task. Only relevant when the task is for making changes, and not just a query. */
	readonly?: boolean;
}

export interface FileExtract {
	/** The file path */
	path: string;
	/** The extract of the file contents which is relevant to the task */
	extract: string;
}

export async function selectFilesAgent(requirements: string, projectInfo?: ProjectInfo): Promise<SelectedFile[]> {
	const { selectedFiles } = await selectFilesCore(requirements, projectInfo);
	return selectedFiles;
}

export async function queryWorkflow(query: string, projectInfo?: ProjectInfo): Promise<string> {
	const { messages, selectedFiles } = await selectFilesCore(query, projectInfo);

	// Construct the final prompt for answering the query
	const finalPrompt = `<query>                                                                                                                                                                                                                                                                                                                                                                                           
${query}
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

	return answer.trim();
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
 * 3 - ASSISTANT: { "selectFiles": [{"path":"file1", "reason":"contains key details"], "ignoreFiles": [{"path":"file2", "reason": "did not contain the config"}] }
 * 2 - USER: <file_contents path="file1"></file_contents><file_contents path="file2"></file_contents>
 * 1 - ASSISTANT: { "inspectFiles": ["file1", "file2"] }
 * 0 - USER : given <task> and <filesystem-tree> and <repository-overview> select initial files for the task.
 *
 * Messages #5
 * 3 - ASSISTANT: { "selectFiles": [{"path":"file1", "reason":"contains key details"], "ignoreFiles": [{"path":"file2", "reason": "did not contain the config"}] }
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
	requirements: string,
	projectInfo?: ProjectInfo,
): Promise<{
	messages: LlmMessage[];
	selectedFiles: SelectedFile[];
}> {
	const messages: LlmMessage[] = await initializeFileSelectionAgent(requirements, projectInfo);

	const maxIterations = 10;
	let iterationCount = 0;

	let llm = llms().medium;

	const initialResponse: InitialResponse = await llm.generateTextWithJson(messages, { id: 'Select Files initial' });
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
		logger.info(response);
		for (const ignored of response.ignoreFiles ?? []) {
			// Use map set to handle potential duplicates from LLM response
			ignoredFiles.set(ignored.path, ignored.reason);
			filesPendingDecision.delete(ignored.path);
		}
		for (const kept of response.keepFiles ?? []) {
			// Use map set to handle potential duplicates from LLM response
			keptFiles.set(kept.path, kept.reason);
			filesPendingDecision.delete(kept.path);
		}

		// Create the user message with the additional file contents to inspect
		messages.push(await processedIterativeStepUserPrompt(response));

		// Don't cache the final result as it would only potentially be used once when generating a query answer
		const cache = filesToInspect.length ? 'ephemeral' : undefined;
		messages.push({
			role: 'assistant',
			content: JSON.stringify(response),
			cache,
		});

		// Max of 4 cache tags with Anthropic. Clear the first one after the cached system prompt
		const cachedMessages = messages.filter((msg) => msg.cache === 'ephemeral');
		if (cachedMessages.length > 4) {
			cachedMessages[1].cache = undefined;
		}

		filesToInspect = response.inspectFiles ?? []; // Ensure filesToInspect is always an array

		// Add newly requested files to pending decision set
		for (const fileToInspect of filesToInspect) {
			filesPendingDecision.add(fileToInspect);
		}

		// We start the file selection process with the medium agent for speed/cost.
		// Once the medium LLM has completed, then we switch to the hard LLM as a review,
		// which may continue inspecting files until it is satisfied.
		if (filesToInspect.length === 0 && filesPendingDecision.size === 0) {
			// Use the hard LLM to review the final selection. Check on a variable and not on llms().medium === llm().hard in case they are the ame.
			if (!usingHardLLM) {
				llm = llms().hard;
				usingHardLLM = true;
			} else {
				// Hard LLM also decided not to inspect more files, break the loop
				break;
			}
		} else if (filesToInspect.length === 0 && filesPendingDecision.size > 0) {
			// LLM didn't request new files, but some files are still pending decision.
			// This might indicate an LLM error or hallucination in the previous step.
			// Force the LLM to process the pending files in the next iteration.
			logger.warn(`LLM did not request new files, but ${filesPendingDecision.size} files are pending decision. Forcing processing.`);
			// No need to add filesToInspect, just continue the loop
		}

		// TODO if keepFiles and ignoreFiles doesnt have all of the files in filesToInspect, then get the LLM to try again
		// filesToInspect = filesToInspect.filter((path) => !keptFiles.has(path) && !ignoredFiles.has(path));
	}

	if (keptFiles.size === 0) throw new Error('No files were selected to fulfill the requirements.');

	// Convert the map entries back to the SelectedFile array structure
	const selectedFiles: SelectedFile[] = Array.from(keptFiles.entries()).map(([path, reason]) => ({
		path,
		reason,
	}));

	return { messages, selectedFiles };
}

async function initializeFileSelectionAgent(requirements: string, projectInfo?: ProjectInfo): Promise<LlmMessage[]> {
	// Ensure projectInfo is available
	projectInfo ??= (await detectProjectInfo())[0];

	// Generate repository maps and overview
	const projectMaps: RepositoryMaps = await generateRepositoryMaps([projectInfo]);
	const repositoryOverview: string = await getRepositoryOverview();
	const fileSystemWithSummaries: string = `<project_files>\n${projectMaps.fileSystemTreeWithFileSummaries.text}\n</project_files>\n`;

	// Construct the initial prompt
	const repoOutlineUserPrompt = `${repositoryOverview}${fileSystemWithSummaries}`;

	// Do not include file contents unless they have been provided to you.
	const initialUserPrompt = `<requirements>\n${requirements}\n</requirements>

Your task is to select the minimal, complete file set from the <project_files> that will be required for completing the task/query in the requirements.

Do not select package manager lock files as they are too large.

For this initial file selection step respond in the following format:
<think>
<!-- extensive thinking on the file selection -->
</think>
<json>
{
  "inspectFiles": [
  	"dir/file1", 
	"dir1/dir2/file2"
  ]
}
</json>
`;
	return [
		{ role: 'user', content: repoOutlineUserPrompt },
		{ role: 'assistant', content: 'What is my task?', cache: 'ephemeral' },
		{ role: 'user', content: initialUserPrompt, cache: 'ephemeral' },
	];
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
The files that must be included in either the keepFiles or ignoreFiles properties are:
${[...Array.from(pendingFiles), ...filesToInspect].join('\n')}`;
	}

	prompt += `
Think extensively about which files keep or ignore, taking into consideration instructions in the requirements. 
Think if you have sufficiently inspected enough files to formulate a result, without excessively inspecting additional files which occurs additional costs, then return an empty array for "inspectFiles"
Do not select package manager lock files to inspect as they are too large.
The final part of the response must be a JSON object in the following format:
<json>
{
  keepFiles:[
    {"path": "dir/file1", "reason": "..."}
  ]
  ignoreFiles:[
    {"path": "dir/file1", "reason": "..."}
  ],
  inspectFiles: [
    "dir1/dir2/file2"
  ]
}
</json>
`;

	const iterationMessages: LlmMessage[] = [...messages, { role: 'user', content: prompt }];

	return await llm.generateTextWithJson(iterationMessages, { id: `Select Files iteration ${iteration}` });
}

/**
 * Generates the user message that we will add to the conversation, which includes the file contents the LLM wishes to inspect
 * @param response
 */
async function processedIterativeStepUserPrompt(response: IterationResponse): Promise<LlmMessage> {
	const ignored = response.ignoreFiles?.map((s) => s.path) ?? [];
	const kept = response.keepFiles?.map((s) => s.path) ?? [];

	let ignoreText = '';
	if (ignored.length) {
		ignoreText = '\nRemoved the following ignored files:';
		for (const ig of response.ignoreFiles) {
			ignoreText += `\n${ig.path} - ${ig.reason}`;
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
