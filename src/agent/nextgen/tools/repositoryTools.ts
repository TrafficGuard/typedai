/**
 * Repository Tools for NextGen Agent Sessions
 *
 * Custom MCP tools that wrap existing CLI functionality for file-tree and query operations.
 * These tools are injected into agent sessions to provide codebase exploration capabilities.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { queryWithFileSelection2 } from '#swe/discovery/selectFilesAgentWithSearch';
import { generateFileSystemTreeWithSummaries } from '#swe/summaries/repositoryMap';
import { loadBuildDocsSummaries } from '#swe/summaries/summaryBuilder';

// Re-export the type from the SDK
export type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * Configuration for creating repository tools
 */
export interface RepositoryToolsConfig {
	/** LLMs to use for tool operations */
	llms: AgentLLMs;
}

/**
 * Uses an LLM to determine which folders are not relevant to the given task.
 * Copied from src/cli/file-tree.ts
 */
async function determineIrrelevantFolders(
	task: string,
	summaries: Map<string, { path: string; short: string; long: string }>,
	agentLLMs: AgentLLMs,
): Promise<string[]> {
	// Build a list of folders with their summaries
	const folderEntries: { path: string; summary: string }[] = [];

	for (const [path, summary] of summaries.entries()) {
		// Only include folder summaries (paths without file extensions or ending with /)
		// Heuristic: folders typically don't have extensions, files do
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

	const response = await agentLLMs.easy.generateText(prompt, { id: 'Determine irrelevant folders' });

	try {
		// Extract JSON from response
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

/**
 * Creates an MCP server with repository exploration tools.
 *
 * Tools available:
 * - file_tree: Generate a file system tree with summaries
 * - query: Query the codebase and get answers with citations
 *
 * @param config - Configuration including LLMs to use
 * @returns MCP server configuration that can be passed to session options
 */
export function createRepositoryToolsServer(config: RepositoryToolsConfig) {
	const { llms } = config;

	const server = createSdkMcpServer({
		name: 'repository-tools',
		version: '1.0.0',
		tools: [
			tool(
				'file_tree',
				'Generate a file system tree with folder and file summaries. Optionally specify a query to collapse irrelevant folders, reducing noise for focused exploration.',
				{
					query: z.string().optional().describe('Optional query to collapse irrelevant folders (e.g., "authentication code")'),
					showFileSummaries: z.boolean().optional().describe('Whether to show file summaries (default: true)'),
				},
				async (args) => {
					try {
						logger.info({ query: args.query, showFileSummaries: args.showFileSummaries }, 'Executing file_tree tool');

						// Load summaries from the repository
						const summaries = await loadBuildDocsSummaries();

						// Determine which folders to collapse if a query is provided
						let collapsedFolders: string[] = [];
						if (args.query) {
							collapsedFolders = await determineIrrelevantFolders(args.query, summaries, llms);
							logger.info({ collapsedCount: collapsedFolders.length }, 'Determined folders to collapse');
						}

						// Generate the tree with optional file summaries
						const tree = await generateFileSystemTreeWithSummaries(summaries, args.showFileSummaries ?? true, collapsedFolders);

						return {
							content: [{ type: 'text', text: tree }],
						};
					} catch (error) {
						logger.error(error, 'file_tree tool failed');
						return {
							content: [{ type: 'text', text: `Error generating file tree: ${(error as Error).message}` }],
						};
					}
				},
			),

			tool(
				'query',
				'Query the codebase and get an answer with file citations. Use this to understand how specific features work, find implementations, or answer questions about the code.',
				{
					question: z.string().describe('Question about the codebase (e.g., "How does user authentication work?")'),
					initialFiles: z.array(z.string()).optional().describe('Optional file paths to include initially for context'),
				},
				async (args) => {
					try {
						logger.info({ question: args.question, initialFilesCount: args.initialFiles?.length }, 'Executing query tool');

						const { files, answer } = await queryWithFileSelection2(args.question, { initialFilePaths: args.initialFiles }, llms);

						// Format the response with the answer and cited files
						const filesJson = JSON.stringify(files, null, 2);
						const response = `${answer}\n\n<cited_files>\n${filesJson}\n</cited_files>`;

						return {
							content: [{ type: 'text', text: response }],
						};
					} catch (error) {
						logger.error(error, 'query tool failed');
						return {
							content: [{ type: 'text', text: `Error querying codebase: ${(error as Error).message}` }],
						};
					}
				},
			),
		],
	});

	return server;
}

/**
 * Default export for convenience
 */
export default createRepositoryToolsServer;
