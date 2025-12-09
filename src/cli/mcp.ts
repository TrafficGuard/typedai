import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { agentContextStorage } from '#agent/agentContext';
import { createContext } from '#agent/agentContextUtils';
import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { queryWithFileSelection2, queryWorkflowWithSearch, selectFilesAgent } from '#swe/discovery/selectFilesAgentWithSearch';
import { loadBuildDocsSummaries } from '#swe/index/repoIndexDocBuilder';
import { generateFileSystemTreeWithSummaries } from '#swe/index/repositoryMap';
import { loadCliEnvironment } from './envLoader';

// Load environment variables
loadCliEnvironment();

// Create MCP server
const server = new McpServer({
	name: 'typedai-server',
	version: '1.0.0',
});

// ============================================================================
// Schema Definitions
// ============================================================================

const SelectedFileSchema = z.object({
	filePath: z.string(),
	reason: z.string().optional(),
	readOnly: z.boolean().optional(),
	category: z.enum(['edit', 'reference', 'style_example', 'unknown']).optional(),
});

// ============================================================================
// Tool: selectFiles
// ============================================================================

server.tool(
	'selectFiles',
	'Select the minimal set of files from a codebase that are essential for a given task or requirement. Uses an iterative LLM-driven search with regex and semantic search capabilities.',
	{
		workingDirectory: z.string().describe('Absolute path to the project/repository directory'),
		requirements: z.string().describe('Description of the task or what files are needed and why'),
		initialFilePaths: z.array(z.string()).optional().describe('Optional initial file paths to include in context'),
	},
	async ({ workingDirectory, requirements, initialFilePaths }) => {
		try {
			const files = await executeWithContext(workingDirectory, async () => {
				return await selectFilesAgent(requirements, {
					initialFilePaths: initialFilePaths ?? undefined,
				});
			});

			return {
				content: [{ type: 'text', text: JSON.stringify(files, null, 2) }],
				structuredContent: { files },
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ error }, 'selectFiles tool error');
			return {
				content: [{ type: 'text', text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ============================================================================
// Tool: queryCodebase
// ============================================================================

server.tool(
	'queryCodebase',
	'Ask a question about a codebase and get a detailed answer with citations to specific files. The agent iteratively searches and reads files to gather context before answering.',
	{
		workingDirectory: z.string().describe('Absolute path to the project/repository directory'),
		query: z.string().describe('Natural language question about the codebase'),
		useHardLLM: z.boolean().optional().describe('Use more powerful LLM for complex queries (slower but more accurate)'),
	},
	async ({ workingDirectory, query, useHardLLM }) => {
		try {
			const answer = await executeWithContext(workingDirectory, async () => {
				return await queryWorkflowWithSearch(query, {
					useHardLLM: useHardLLM ?? false,
				});
			});

			return {
				content: [{ type: 'text', text: answer }],
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ error }, 'queryCodebase tool error');
			return {
				content: [{ type: 'text', text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ============================================================================
// Tool: queryWithFileSelection
// ============================================================================

server.tool(
	'queryWithFileSelection',
	'Query the codebase and also return the list of files that were analyzed to generate the answer. Combines file selection with question answering.',
	{
		workingDirectory: z.string().describe('Absolute path to the project/repository directory'),
		query: z.string().describe('Natural language question about the codebase'),
		useHardLLM: z.boolean().optional().describe('Use more powerful LLM for complex queries (slower but more accurate)'),
		initialFilePaths: z.array(z.string()).optional().describe('Optional initial file paths to include in context'),
	},
	async ({ workingDirectory, query, useHardLLM, initialFilePaths }) => {
		try {
			const result = await executeWithContext(workingDirectory, async () => {
				return await queryWithFileSelection2(query, {
					useHardLLM: useHardLLM ?? false,
					initialFilePaths: initialFilePaths ?? undefined,
				});
			});

			return {
				content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
				structuredContent: result,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ error }, 'queryWithFileSelection tool error');
			return {
				content: [{ type: 'text', text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

// ============================================================================
// Tool: fileTree
// ============================================================================

server.tool(
	'fileTree',
	'Generate a file system tree with folder/file summaries. Can collapse folders not relevant to a specific task to reduce noise.',
	{
		workingDirectory: z.string().describe('Absolute path to the project/repository directory'),
		task: z.string().optional().describe('Optional task/query description - irrelevant folders will be collapsed'),
		includeFileSummaries: z.boolean().optional().describe('Include file-level summaries (default: folder summaries only)'),
	},
	async ({ workingDirectory, task, includeFileSummaries }) => {
		try {
			const result = await executeWithContext(workingDirectory, async () => {
				// Load summaries
				const summaries = await loadBuildDocsSummaries();

				let collapsedFolders: string[] = [];

				if (task) {
					// Use LLM to determine which folders to collapse
					collapsedFolders = await determineIrrelevantFolders(task, summaries);
				}

				// Generate the tree
				const tree = await generateFileSystemTreeWithSummaries(summaries, includeFileSummaries ?? false, collapsedFolders);

				return { tree, collapsedFolders };
			});

			return {
				content: [{ type: 'text', text: result.tree }],
				structuredContent: result,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ error }, 'fileTree tool error');
			return {
				content: [{ type: 'text', text: `Error: ${message}` }],
				isError: true,
			};
		}
	},
);

/**
 * Uses an LLM to determine which folders are not relevant to the given task.
 */
async function determineIrrelevantFolders(task: string, summaries: Map<string, Summary>): Promise<string[]> {
	const folderEntries: { path: string; summary: string }[] = [];

	for (const [path, summary] of summaries.entries()) {
		const isLikelyFolder = !path.includes('.') || path.endsWith('/');
		if (isLikelyFolder && summary.short) {
			folderEntries.push({ path, summary: summary.short });
		}
	}

	if (folderEntries.length === 0) {
		return [];
	}

	const folderList = folderEntries.map((f) => `${f.path}: ${f.summary}`).join('\n');

	const prompt = `You are analyzing a codebase to determine which folders are relevant to a specific task.

<task>
${task}
</task>

<folders>
${folderList}
</folders>

Based on the task description and folder summaries, identify folders that are NOT relevant to completing this task. These folders will be collapsed/hidden in the file tree to reduce noise.

Be conservative - when in doubt, keep a folder visible. Only collapse folders that are clearly unrelated.

Respond with a JSON array of folder paths to collapse (hide). If all folders seem relevant, return an empty array.

Example response:
["node_modules", "dist", "coverage", "docs/api-reference"]

<json>
`;

	const llms = defaultLLMs();
	const response = await llms.easy.generateText(prompt, { id: 'Determine irrelevant folders' });

	try {
		let jsonStr = response;
		const jsonMatch = response.match(/\[[\s\S]*?\]/);
		if (jsonMatch) {
			jsonStr = jsonMatch[0];
		}
		const folders = JSON.parse(jsonStr);
		if (Array.isArray(folders)) {
			return folders.filter((f) => typeof f === 'string');
		}
	} catch (e) {
		logger.warn('Failed to parse LLM response for folder collapsing:', e);
	}

	return [];
}

interface Summary {
	path: string;
	short: string;
	long: string;
}

// ============================================================================
// Helper: Execute with filesystem context
// ============================================================================

/**
 * Executes an operation with a properly configured filesystem context.
 * Creates an agent context for the given working directory and runs the operation within it.
 */
async function executeWithContext<T>(workingDirectory: string, operation: () => Promise<T>): Promise<T> {
	const config = {
		agentName: 'MCP Discovery',
		subtype: 'mcp-discovery',
		llms: defaultLLMs(),
		functions: [],
		initialPrompt: '',
		fileSystemPath: workingDirectory,
		humanInLoop: { budget: 0 },
	};

	const context = createContext(config);

	return new Promise((resolve, reject) => {
		agentContextStorage.run(context, async () => {
			try {
				const result = await operation();
				resolve(result);
			} catch (e) {
				reject(e);
			}
		});
	});
}

// ============================================================================
// Main
// ============================================================================

async function main() {
	await initApplicationContext();

	const transport = new StdioServerTransport();
	logger.info('TypedAI MCP server starting on stdio');

	await server.connect(transport);
	logger.info('TypedAI MCP server connected');
}

main().catch(async (err) => {
	logger.error(err, 'MCP server error');
	await shutdownTrace();
	process.exit(1);
});
