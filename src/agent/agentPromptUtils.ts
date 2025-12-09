import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import type { FileStore } from '#functions/storage/filestore';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import type { FileMetadata } from '#shared/files/files.model';
import { includeAlternativeAiToolFiles } from '#swe/includeAlternativeAiToolFiles';
import type { Summary } from '#swe/index/llmSummaries';
import { loadBuildDocsSummaries } from '#swe/index/repoIndexDocBuilder';
import { generateFileSystemTreeWithSummaries } from '#swe/index/repositoryMap';
import { getProjectInfo } from '#swe/projectDetection';
import path from 'node:path';

/**
 * @return An XML representation of the agent's memory
 */
export async function buildMemoryPrompt(): Promise<string> {
	const memory = agentContext()!.memory;
	let result = '<memory>\n';
	for (const mem of Object.entries(memory)) {
		const tokens = await countTokens(mem[1]);
		result += `<${mem[0]} tokens="${tokens}">\n${mem[1]}\n</${mem[0]}>\n`;
	}
	result += '</memory>\n';
	return result;
}

/**
 * Build the state information for selected tools
 * TODO move the string generation into the tool classes
 */
export async function buildToolStatePrompt(): Promise<string> {
	return (await buildLiveFilesPrompt()) + (await buildFileStorePrompt()) + (await buildFileSystemServicePrompt());
}

export async function buildFileSystemTreePrompt(): Promise<string> {
	const agent = agentContext(); // Get the full agent context
	if (!agent?.functions?.getFunctionClassNames().includes(FileSystemTree.name)) {
		return ''; // Tool not active
	}

	// Initialize toolState from projectInfo config if not already set
	if (!agent.toolState?.FileSystemTree) {
		const projectInfo = await getProjectInfo();
		const defaultCollapsed = projectInfo?.fileSystemTree?.collapse || [];

		if (defaultCollapsed.length > 0) {
			// Get file system paths for translation
			const fss = getFileSystem();
			const vcsRoot = fss.getVcsRoot();
			const workingDir = fss.getWorkingDirectory();

			// Translate config paths to be relative to current working directory
			const translatedPaths = defaultCollapsed
				.map((configPath) => {
					// Config paths are relative to VCS root (where .typedai.json lives)
					const absolutePath = path.isAbsolute(configPath) ? configPath : path.resolve(vcsRoot || workingDir, configPath);

					// Make it relative to current working directory
					const relativePath = path.relative(workingDir, absolutePath);
					return relativePath;
				})
				.filter((p) => p && !p.startsWith('..')); // Filter out invalid/parent paths

			// Store in agent toolState
			agent.toolState ??= {};
			agent.toolState.FileSystemTree = Array.from(new Set(translatedPaths));
		} else {
			// Initialize as empty array if no defaults
			agent.toolState ??= {};
			agent.toolState.FileSystemTree = [];
		}
	}

	// Ensure agent.toolState.FileSystemTree is treated as an array, defaulting to empty if not present or not an array.
	let collapsedFolders: string[] = agent.toolState?.FileSystemTree ?? [];
	if (!Array.isArray(collapsedFolders)) {
		logger.warn(
			{ currentToolState: agent.toolState?.FileSystemTree },
			`agent.toolState.FileSystemTree was not an array (type: ${typeof collapsedFolders}). Defaulting to empty array.`,
		);
		collapsedFolders = [];
	}

	try {
		const summaries: Map<string, Summary> = await loadBuildDocsSummaries();
		// For this prompt, we typically don't want file summaries to keep it concise,
		// focusing on folder structure and collapsed state.
		const treeString = await generateFileSystemTreeWithSummaries(summaries, true, collapsedFolders);

		if (!treeString.trim()) return '\n<file_system_tree>\n<!-- File system is empty or all folders are collapsed at the root. -->\n</file_system_tree>\n';

		const tokens = await countTokens(treeString);

		return `\n<file_system_tree tokens="${tokens}">
${treeString}
</file_system_tree>\n<file_system_tree_collapsed_folders>\n${collapsedFolders.join('\n')}\n</file_system_tree_collapsed_folders>`;
	} catch (error) {
		logger.error(error, 'Error building file system tree prompt');
		return '\n<file_system_tree>\n<!-- Error generating file system tree. -->\n</file_system_tree>\n';
	}
}

/**
 * @return An XML representation of the FileSystemService tool state
 */
async function buildFileSystemServicePrompt(): Promise<string> {
	const functions = agentContext()!.functions;
	const hasAnyFileSystemFunction = functions.getFunctionClassNames().some((name) => name.startsWith('FileSystem'));
	if (!hasAnyFileSystemFunction) return '';
	const fss = getFileSystem();
	const vcsRoot = fss.getVcsRoot();
	return `\n<file_system>
	<base_path>${fss.getBasePath()}</base_path>
	<current_working_directory>${fss.getWorkingDirectory()}</current_working_directory>
	${vcsRoot ? `<git_repository_root_dir>${vcsRoot}</git_repository_root_dir>\n<git_current_branch>${await fss.getVcs().getBranchName()}</git_current_branch>` : ''}
</file_system>
`;
}

/**
 * @return An XML representation of the FileStore tool if one exists in the agents functions
 */
async function buildFileStorePrompt(): Promise<string> {
	const fileStore = agentContext()!.functions.getFunctionType('filestore') as FileStore;
	if (!fileStore) return '';
	const files: FileMetadata[] = await fileStore.listFiles();
	if (!files.length) return '';
	return `\n<filestore>
${JSON.stringify(files)}
</filestore>
`;
}

/**
 * @return An XML representation of the Live Files tool if one exists in the agents functions
 * along with the relevant documentation files for the AI
 */
async function buildLiveFilesPrompt(): Promise<string> {
	const agent = agentContext()!;
	if (!agent.functions.getFunctionClassNames().includes(LiveFiles.name)) return '';

	const liveFiles = agent.toolState?.LiveFiles ?? [];
	if (!liveFiles || !liveFiles.length)
		return '\n<live_files>\n<!-- No files selected. Live files will have their current contents displayed here -->\n</live_files>';

	const rulesFiles = await includeAlternativeAiToolFiles(liveFiles);
	for (const liveFile of liveFiles) {
		if (rulesFiles.has(liveFile)) rulesFiles.delete(liveFile);
	}
	let rulesFilesPrompt = '';
	if (rulesFiles.size) {
		rulesFilesPrompt = `<!-- Rules files are automatically included based on the LiveFiles selection -->\n<rules_files>\n${await getFileSystem().readFilesAsXml(Array.from(rulesFiles.values()))}\n</rules_files>\n`;
	}

	return `\n${rulesFilesPrompt}<live_files>
${await getFileSystem().readFilesAsXml(liveFiles, true)}
</live_files>
`;
}

/**
 * @param type if we are building for history or the last execution results
 * @param maxLength {number} The maximum length of the returned string
 * @param fromIndex {number} The index of the function calls history to build from. Defaults from the start of the array.
 * @param toIndex {number} The index of the function calls history to build to. Defaults to the end of the array.
 * @return An XML representation of the agent's function call history, limiting the history to a maximum length
 * of the returned string
 */
export function buildFunctionCallHistoryPrompt(type: 'history' | 'results', maxLength = 20000, fromIndex = 0, toIndex = 0): string {
	const fullHistory = agentContext()!.functionCallHistory;
	if (fullHistory.length === 0) return `<function_call_${type}>\n</function_call_${type}>\n`;

	const functionCalls = fullHistory.slice(fromIndex, toIndex === 0 ? fullHistory.length : toIndex);
	let result = '';

	// To maintain a maximum length, we will iterate over the function calls in reverse order
	let currentLength = result.length; // Start with the length of the result header

	// Iterate over function calls in reverse order (newest first)
	for (let i = functionCalls.length - 1; i >= 0; i--) {
		const call = functionCalls[i]!;
		// Ensure parameters is always an object
		const parameters = call.parameters || {};
		let params = '';
		if (Object.keys(parameters).length > 0) {
			for (let [name, value] of Object.entries(parameters)) {
				if (Array.isArray(value)) value = JSON.stringify(value, null, ' ');
				// if (typeof value === 'string' && value.length > 150) value = `${value.slice(0, 150)}...`;
				// if (typeof value === 'string') value = value.replace('"', '\\"');
				params += `\n  "${name}": "${value}",`;
			}
		} else {
			logger.info(`No parameters on call ${JSON.stringify(call)}`);
		}

		// Strip trailing comma
		if (params.length) params.substring(0, params.length - 2);

		let output = '';
		if (call.stdoutSummary) {
			output += `<output_summary>${call.stdoutSummary}</output_summary>\n`;
		} else if (call.stdout) {
			output += `<output>${call.stdout}</output>\n`;
		}
		if (call.stderrSummary) {
			output += `<error_summary>${call.stderrSummary}</error_summary>\n`;
		} else if (call.stderr) {
			output += `<error>${call.stderr}</error>\n`;
		}

		// Construct the function call string
		const paramString = Object.keys(parameters).length > 0 ? `{${params}}` : '';
		const functionCallString = `<function_call>\n ${call.function_name}(${paramString})\n ${output}</function_call>\n`;
		const newLength = currentLength + functionCallString.length;

		// Check if adding this function call goes beyond maxLength
		if (newLength > maxLength) {
			break; // Stop adding if we exceed the max length
		}

		result = functionCallString + result; // Prepend to result
		currentLength = newLength; // Update currentLength
	}

	if (functionCalls.length > 1) result = `<!-- Oldest -->\n${result}<!-- Newest -->\n`;
	result = `<function_call_${type}>\n${result}\n</function_call_${type}>\n`;
	return result;
}

/**
 * Update the system prompt to include all the function schemas available to the agent.
 * Requires the system prompt to contain <functions></functions>
 * @param systemPrompt {string} the initial system prompt
 * @param functionSchemas {string} the function schemas
 * @returns the updated system prompt
 */
export function updateFunctionSchemas(systemPrompt: string, functionSchemas: string): string {
	const regex = /<functions>[\s\S]*?<\/functions>/g;
	const updatedPrompt = systemPrompt.replace(regex, functionSchemas);
	if (!updatedPrompt.includes(functionSchemas)) throw new Error('Unable to update function schemas. Regex replace failed');
	return updatedPrompt;
}

/**
 * Builds a map representing the state of tools that expose a getToolState method.
 * @param functionInstances An array of function class instances.
 * @returns A promise resolving to a Map where keys are class names and values are their states.
 */
export async function buildToolStateMap(functionInstances: object[]): Promise<Record<string, any>> {
	const toolStateMap = {};
	for (const instance of functionInstances) {
		if (typeof (instance as any).getToolState === 'function') {
			try {
				const state = await (instance as any).getToolState();
				if (state !== null && state !== undefined) {
					toolStateMap[instance.constructor.name] = state;
				}
			} catch (error) {
				logger.error(error, `Error getting tool state for ${instance.constructor.name}`);
			}
		}
	}
	return toolStateMap;
}
