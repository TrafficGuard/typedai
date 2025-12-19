/**
 * Configurable tools for the multi-agent debate system.
 *
 * Tools can be customized per debate depending on the problem domain:
 * - Technical Q&A: codebase search, file reading, web search
 * - Code review: code tracing, lint tools
 * - General research: web search, document fetching
 *
 * @module agentic-debate/tools
 */

import { readFile as fsReadFile } from 'node:fs/promises';
import { arg, spawnCommand } from '#utils/exec';
import type { DebateTool, ToolResult } from './toolEnabledDebate';

// ============================================================================
// Tool Creation Helpers
// ============================================================================

/**
 * Creates a DebateTool with sensible defaults
 */
export function createDebateTool(config: {
	name: string;
	sdkName?: string;
	description: string;
	parameters: DebateTool['parameters'];
	execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}): DebateTool {
	return {
		name: config.name,
		sdkName: config.sdkName,
		description: config.description,
		parameters: config.parameters,
		execute: config.execute,
	};
}

/**
 * Wraps a tool execution with timing and error handling
 */
export function wrapToolExecution(execute: (params: Record<string, unknown>) => Promise<unknown>): (params: Record<string, unknown>) => Promise<ToolResult> {
	return async (params: Record<string, unknown>): Promise<ToolResult> => {
		const startTime = Date.now();
		try {
			const data = await execute(params);
			return {
				success: true,
				data,
				executionTimeMs: Date.now() - startTime,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				executionTimeMs: Date.now() - startTime,
			};
		}
	};
}

// ============================================================================
// Tool Execution Interface
// ============================================================================

/**
 * Interface for tool executor - allows dependency injection for testing
 */
export interface IToolExecutor {
	searchCodebase(pattern: string, contextLines?: number): Promise<string>;
	readFile(path: string, startLine?: number, endLine?: number): Promise<string>;
	webSearch(query: string): Promise<string>;
	webFetch(url: string, prompt: string): Promise<string>;
	vectorSearch?(query: string, maxResults?: number): Promise<string>;
}

// ============================================================================
// Default Tool Implementations
// ============================================================================

/**
 * Creates a codebase search tool
 */
export function createCodebaseSearchTool(executor: IToolExecutor): DebateTool {
	return createDebateTool({
		name: 'Search_codebase',
		sdkName: 'Grep',
		description: 'Search the codebase for files or content matching a regex pattern. Returns matching lines with context.',
		parameters: {
			pattern: {
				type: 'string',
				description: 'Regular expression pattern to search for',
				required: true,
			},
			contextLines: {
				type: 'number',
				description: 'Number of context lines before and after matches (default: 2)',
				required: false,
			},
		},
		execute: wrapToolExecution(async (params) => {
			const pattern = params.pattern as string;
			const contextLines = (params.contextLines as number) ?? 2;
			return executor.searchCodebase(pattern, contextLines);
		}),
	});
}

/**
 * Creates a file reading tool
 */
export function createReadFileTool(executor: IToolExecutor): DebateTool {
	return createDebateTool({
		name: 'Read_file',
		sdkName: 'Read',
		description: 'Read the contents of a specific file to extract evidence. Can optionally read a specific line range.',
		parameters: {
			path: {
				type: 'string',
				description: 'Path to the file to read',
				required: true,
			},
			startLine: {
				type: 'number',
				description: 'Starting line number (1-indexed, optional)',
				required: false,
			},
			endLine: {
				type: 'number',
				description: 'Ending line number (1-indexed, optional)',
				required: false,
			},
		},
		execute: wrapToolExecution(async (params) => {
			const path = params.path as string;
			const startLine = params.startLine as number | undefined;
			const endLine = params.endLine as number | undefined;
			return executor.readFile(path, startLine, endLine);
		}),
	});
}

/**
 * Creates a web search tool
 */
export function createWebSearchTool(executor: IToolExecutor): DebateTool {
	return createDebateTool({
		name: 'WebSearch',
		sdkName: 'WebSearch',
		description: 'Search the web for documentation, articles, or verification of claims. Returns relevant search results.',
		parameters: {
			query: {
				type: 'string',
				description: 'Search query',
				required: true,
			},
		},
		execute: wrapToolExecution(async (params) => {
			const query = params.query as string;
			return executor.webSearch(query);
		}),
	});
}

/**
 * Creates a web fetch tool
 */
export function createWebFetchTool(executor: IToolExecutor): DebateTool {
	return createDebateTool({
		name: 'WebFetch',
		sdkName: 'WebFetch',
		description: 'Fetch and extract specific content from a URL. Useful for reading documentation pages.',
		parameters: {
			url: {
				type: 'string',
				description: 'URL to fetch',
				required: true,
			},
			prompt: {
				type: 'string',
				description: 'What information to extract from the page',
				required: true,
			},
		},
		execute: wrapToolExecution(async (params) => {
			const url = params.url as string;
			const prompt = params.prompt as string;
			return executor.webFetch(url, prompt);
		}),
	});
}

/**
 * Creates a vector/semantic search tool
 */
export function createVectorSearchTool(executor: IToolExecutor): DebateTool | null {
	if (!executor.vectorSearch) return null;

	return createDebateTool({
		name: 'Search_vector',
		sdkName: 'Bash', // Uses custom command under the hood
		description: 'Semantic search across the indexed codebase. Useful for finding conceptually related code.',
		parameters: {
			query: {
				type: 'string',
				description: 'Natural language query describing what to find',
				required: true,
			},
			maxResults: {
				type: 'number',
				description: 'Maximum number of results to return (default: 10)',
				required: false,
			},
		},
		execute: wrapToolExecution(async (params) => {
			const query = params.query as string;
			const maxResults = (params.maxResults as number) ?? 10;
			return executor.vectorSearch!(query, maxResults);
		}),
	});
}

// ============================================================================
// Default Tool Executor (Production)
// ============================================================================

/**
 * Default tool executor using real implementations
 * This can be replaced with mocks for testing
 */
export function createDefaultToolExecutor(): IToolExecutor {
	return {
		async searchCodebase(pattern: string, contextLines = 2): Promise<string> {
			const results = await spawnCommand(`rg ${arg(pattern)} -C ${contextLines} --max-count=50`);
			if (results.exitCode > 0 && results.stderr) {
				throw new Error(results.stderr);
			}
			return results.stdout || 'No matches found';
		},

		async readFile(path: string, startLine?: number, endLine?: number): Promise<string> {
			const content = await fsReadFile(path, 'utf-8');

			if (startLine !== undefined || endLine !== undefined) {
				const lines = content.split('\n');
				const start = (startLine ?? 1) - 1;
				const end = endLine ?? lines.length;
				return lines.slice(start, end).join('\n');
			}

			return content;
		},

		async webSearch(query: string): Promise<string> {
			// Default implementation - users should provide a custom executor
			// with their preferred search provider (e.g., Perplexity, SerpAPI)
			return `Web search not configured. Query: ${query}. Provide a custom IToolExecutor with webSearch implementation.`;
		},

		async webFetch(url: string, prompt: string): Promise<string> {
			// Default implementation - users should provide a custom executor
			// with their preferred web fetching implementation
			return `Web fetch not configured. URL: ${url}, Prompt: ${prompt}. Provide a custom IToolExecutor with webFetch implementation.`;
		},
	};
}

// ============================================================================
// Tool Presets
// ============================================================================

/**
 * Creates the default set of debate tools
 */
export function createDefaultDebateTools(executor?: IToolExecutor): DebateTool[] {
	const exec = executor ?? createDefaultToolExecutor();

	const tools: DebateTool[] = [createCodebaseSearchTool(exec), createReadFileTool(exec), createWebSearchTool(exec), createWebFetchTool(exec)];

	const vectorTool = createVectorSearchTool(exec);
	if (vectorTool) {
		tools.push(vectorTool);
	}

	return tools;
}

/**
 * Creates tools optimized for technical Q&A
 */
export function createTechnicalQATools(executor?: IToolExecutor): DebateTool[] {
	// Same as default for now, but could be customized
	return createDefaultDebateTools(executor);
}

/**
 * Creates tools optimized for code review
 */
export function createCodeReviewTools(executor?: IToolExecutor): DebateTool[] {
	// Same as default for now, but could add linting tools
	return createDefaultDebateTools(executor);
}

// ============================================================================
// Tool Utilities
// ============================================================================

/**
 * Executes a list of tool requests and returns the results
 */
export async function executeToolRequests(
	tools: DebateTool[],
	requests: Array<{ toolName: string; parameters: Record<string, unknown> }>,
	agentId: string,
): Promise<import('./toolEnabledDebate').ToolCallRecord[]> {
	const toolMap = new Map(tools.map((t) => [t.name, t]));
	const results: import('./toolEnabledDebate').ToolCallRecord[] = [];

	for (const request of requests) {
		const tool = toolMap.get(request.toolName);
		if (!tool) {
			results.push({
				toolName: request.toolName,
				parameters: request.parameters,
				result: {
					success: false,
					error: `Unknown tool: ${request.toolName}`,
				},
				timestamp: new Date(),
				agentId,
			});
			continue;
		}

		const result = await tool.execute(request.parameters);
		results.push({
			toolName: request.toolName,
			parameters: request.parameters,
			result,
			timestamp: new Date(),
			agentId,
		});
	}

	return results;
}

/**
 * Formats tool results for inclusion in prompts
 */
export function formatToolResultsForPrompt(toolCalls: import('./toolEnabledDebate').ToolCallRecord[]): string {
	if (toolCalls.length === 0) return '';

	return toolCalls
		.map((call) => {
			const status = call.result.success ? 'SUCCESS' : 'ERROR';
			const content = call.result.success ? JSON.stringify(call.result.data, null, 2) : call.result.error;

			return `<tool_result name="${call.toolName}" status="${status}">
${content}
</tool_result>`;
		})
		.join('\n\n');
}

/**
 * Gets the list of tool names for Claude Agent SDK
 */
export function getToolSdkNames(tools: DebateTool[]): string[] {
	return tools.filter((t) => t.sdkName).map((t) => t.sdkName!);
}
