import path from 'node:path';
import { getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { extractTag } from '#llm/responseParsers';
import { logger } from '#o11y/logger';
import {
	type GenerateTextWithJsonResponse,
	ImagePartExt,
	type LLM,
	type LlmMessage,
	type UserContentExt,
	assistant,
	contentText,
	extractAttachments,
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
	readOnly?: boolean;
	category?: 'edit' | 'reference' | 'style_example' | 'unknown';
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

export async function queryWorkflow(query: UserContentExt, projectInfo?: ProjectInfo): Promise<string> {
	if (!query) throw new Error('query must be provided');
	const { files, answer } = await queryWithFileSelection(query, projectInfo);
	return answer;
}

export async function queryWithFileSelection(query: UserContentExt, projectInfo?: ProjectInfo): Promise<{ files: SelectedFile[]; answer: string }> {
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
		logger.info(response);
		for (const ignored of response.ignoreFiles ?? []) {
			ignoredFiles.set(ignored.path, ignored.reason);
			filesPendingDecision.delete(ignored.path);
		}
		for (const kept of response.keepFiles ?? []) {
			keptFiles.set(kept.path, kept.reason);
			filesPendingDecision.delete(kept.path);
		}

		// Include relevant rules/documentation/guideline files
		const justKeptPaths = response.keepFiles?.map((f) => f.path) ?? [];
		if (justKeptPaths.length > 0) {
			try {
				const cwd = getFileSystem().getWorkingDirectory();
				// Assuming projectInfo.baseDir corresponds to the VCS root for the purpose of finding config files
				const vcsRoot = getFileSystem().getVcsRoot();
				const alternativeFiles = await includeAlternativeAiToolFiles(justKeptPaths, { cwd, vcsRoot });
				for (const altFile of alternativeFiles) {
					// Add the alternative file only if it hasn't been explicitly kept or ignored already
					if (!keptFiles.has(altFile) && !ignoredFiles.has(altFile)) {
						keptFiles.set(altFile, 'Relevant AI tool configuration/documentation file');
						logger.info(`Automatically included relevant AI tool file: ${altFile}`);
					}
				}
			} catch (error) {
				logger.warn(error, `Failed to check for or include alternative AI tool files based on: ${justKeptPaths.join(', ')}`);
			}
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

		filesToInspect = response.inspectFiles ?? [];

		// Add newly requested files to pending decision set
		for (const fileToInspect of filesToInspect) {
			filesPendingDecision.add(fileToInspect);
		}

		// We start the file selection process with the medium agent for speed/cost.
		// Once the medium LLM has completed, then we switch to the hard LLM as a review,
		// which may continue inspecting files until it is satisfied.
		if (filesToInspect.length === 0 && filesPendingDecision.size === 0) {
			// Use the hard LLM to review the final selection. Check on a variable and not on llms().medium === llm().hard in case they are the same.
			if (!usingHardLLM) {
				llm = llms().hard;
				usingHardLLM = true;
			} else {
				// Hard LLM also decided not to inspect more files, break the loop
				break;
			}
		} else if (filesToInspect.length === 0 && filesPendingDecision.size > 0) {
			// LLM didn't request new files, but some files are still pending decision.
			logger.warn(`LLM did not request new files, but ${filesPendingDecision.size} files are pending decision. Forcing processing.`);
		}
	}

	if (keptFiles.size === 0) throw new Error('No files were selected to fulfill the requirements.');

	const selectedFiles: SelectedFile[] = Array.from(keptFiles.entries()).map(([path, reason]) => ({
		path,
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
		const filePaths = options.currentFiles.map((selection) => selection.path);
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
The files that must be included in either the keepFiles or ignoreFiles properties are:
${[...Array.from(pendingFiles), ...filesToInspect].join('\n')}`;
	}

	prompt += `
The files that must be decided upon (kept or ignored) in this iteration are:
${[...Array.from(pendingFiles)].join('\n')}

First think extensively about which files to keep or ignore based *strictly* on the requirements.
- For **keepFiles**: Only include a file if its contents are **demonstrably necessary** to fulfill the requirements. The 'reason' must clearly state *why* this specific file is essential.
- For **ignoreFiles**: Include files previously inspected that are **not essential** for the task.
- For **inspectFiles**: Only request to inspect *new* files if you have a **strong, specific reason** to believe they contain information **critical** to the task that hasn't been found yet. Avoid speculative inspection. Consider the cost – only inspect if absolutely necessary.

Have you inspected enough files to confidently determine the minimal essential set? If yes, or if no further files seem strictly necessary, return an empty array for "inspectFiles".

The final part of the response must be a JSON object in the following format:
<json>
{
  "keepFiles": [
    {"path": "path/to/essential/file1", "reason": "Clearly explains why this file is indispensable for the task."}
  ],
  "ignoreFiles": [
    {"path": "path/to/nonessential/file2", "reason": "Explains why this file is not needed."}
  ],
  "inspectFiles": [
    "path/to/potentially/critical/file3"
  ]
}
</json>
`;

	const iterationMessages: LlmMessage[] = [...messages, { role: 'user', content: prompt }];

	const response: GenerateTextWithJsonResponse<IterationResponse> = await llm.generateTextWithJson(iterationMessages, {
		id: `Select Files iteration ${iteration}`,
	});
	return response.object;
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
