/**
 * Tool Groups for NextGen Agent
 *
 * Defines groups of related tools that can be loaded together.
 * Maps to existing @funcClass patterns in the codebase.
 */

import type { FunctionSchema, ToolGroup } from '../core/types';

/**
 * Registry of all available tool groups
 */
export const TOOL_GROUPS: Record<string, ToolGroup> = {
	// Core tools - always available
	FileSystem: {
		name: 'FileSystem',
		description: 'File system operations: read, write, list, search',
		functions: ['readFile', 'writeFile', 'listFilesInDirectory', 'searchFilesMatchingContents', 'searchExtractsMatchingContents'],
	},
	Agent: {
		name: 'Agent',
		description: 'Agent control: complete, memory, feedback, tool loading',
		functions: ['completed', 'saveMemory', 'getMemory', 'requestFeedback', 'loadToolGroup', 'spawnSubAgent'],
	},

	// Loadable tool groups
	Git: {
		name: 'Git',
		description: 'Local git operations: commits, branches, diffs',
		functions: ['commit', 'createBranch', 'switchBranch', 'getDiff', 'getStagedDiff', 'getStagedFiles', 'pull', 'push', 'getBranchName', 'stageFiles'],
	},
	GitHub: {
		name: 'GitHub',
		description: 'GitHub API operations: issues, PRs, branches, actions',
		functions: [
			'createIssue',
			'postCommentOnIssue',
			'getIssueComments',
			'cloneProject',
			'createMergeRequest',
			'getProjects',
			'getBranches',
			'listJobsForWorkflowRun',
			'getJobLogs',
			'getOpenPullRequests',
		],
	},
	GitLab: {
		name: 'GitLab',
		description: 'GitLab API operations: issues, MRs, projects',
		functions: ['createIssue', 'createMergeRequest', 'getProjects', 'getBranches', 'cloneProject', 'getMergeRequests'],
	},
	Web: {
		name: 'Web',
		description: 'Web operations: fetch, search, scrape',
		functions: ['fetch', 'search', 'scrapeUrl', 'webSearch'],
	},
	Jira: {
		name: 'Jira',
		description: 'Jira operations: issues, comments',
		functions: ['createIssue', 'getIssue', 'updateIssue', 'addComment', 'searchIssues'],
	},
	Confluence: {
		name: 'Confluence',
		description: 'Confluence operations: pages, content',
		functions: ['getPage', 'createPage', 'updatePage', 'searchContent'],
	},
	TypeScript: {
		name: 'TypeScript',
		description: 'TypeScript/Node.js operations: npm, packages',
		functions: ['runNpmScript', 'installPackage', 'getInstalledPackages', 'runTypeCheck'],
	},
	Python: {
		name: 'Python',
		description: 'Python operations: scripts, packages',
		functions: ['runScript', 'installPackage', 'runPytest'],
	},
	CommandLine: {
		name: 'CommandLine',
		description: 'Shell command execution',
		functions: ['executeCommand', 'executeBackgroundCommand'],
	},
	LiveFiles: {
		name: 'LiveFiles',
		description: 'Track files across iterations',
		functions: ['addFiles', 'removeFiles', 'getTrackedFiles', 'clearFiles'],
	},
	CodeEditor: {
		name: 'CodeEditor',
		description: 'Code editing with search/replace',
		functions: ['editFile', 'createFile', 'applyDiff'],
	},
};

/**
 * Gets a tool group by name
 */
export function getToolGroup(name: string): ToolGroup | undefined {
	return TOOL_GROUPS[name];
}

/**
 * Gets all available tool group names
 */
export function getAvailableGroups(): string[] {
	return Object.keys(TOOL_GROUPS);
}

/**
 * Gets tool groups that are always loaded (core tools)
 */
export function getCoreGroups(): string[] {
	return ['FileSystem', 'Agent'];
}

/**
 * Gets tool groups that need to be explicitly loaded
 */
export function getLoadableGroups(): string[] {
	const core = new Set(getCoreGroups());
	return getAvailableGroups().filter((g) => !core.has(g));
}

/**
 * Builds the tool index for the system prompt
 * This is a compact representation of all available tools
 */
export function buildToolIndex(): string {
	const lines: string[] = ['<available_tools>'];

	// Core tools (always available)
	lines.push('## Core (always available)');
	for (const groupName of getCoreGroups()) {
		const group = TOOL_GROUPS[groupName];
		lines.push(`- ${group.name}: ${group.functions.join(', ')}`);
	}

	// Loadable groups
	lines.push('');
	lines.push('## Loadable Groups (use Agent_loadToolGroup to access)');
	for (const groupName of getLoadableGroups()) {
		const group = TOOL_GROUPS[groupName];
		lines.push(`- ${group.name}: ${group.functions.join(', ')}`);
	}

	lines.push('</available_tools>');
	return lines.join('\n');
}

/**
 * Formats a tool group's schemas for inclusion in context
 */
export function formatToolGroupSchemas(group: ToolGroup, schemas: FunctionSchema[]): string {
	const lines: string[] = [`## ${group.name} Tools`];
	lines.push(group.description);
	lines.push('');

	for (const schema of schemas) {
		lines.push(`### ${schema.name}`);
		lines.push(schema.description);
		if (Object.keys(schema.parameters).length > 0) {
			lines.push('Parameters:');
			lines.push('```json');
			lines.push(JSON.stringify(schema.parameters, null, 2));
			lines.push('```');
		}
		lines.push('');
	}

	return lines.join('\n');
}

/**
 * Suggests relevant tool groups based on task description
 */
export function suggestToolGroups(
	taskDescription: string,
	projectContext?: { scmType?: 'github' | 'gitlab'; hasJira?: boolean; hasConfluence?: boolean },
): string[] {
	const suggestions: string[] = [];
	const text = taskDescription.toLowerCase();

	// SCM-related suggestions
	if (/pull request|pr\b|merge request|branch|commit|diff/i.test(text)) {
		suggestions.push('Git');
		// Default to GitHub for PR-related tasks unless GitLab is explicitly mentioned
		if (/pull request|pr\b/i.test(text) || projectContext?.scmType === 'github' || /github/i.test(text)) {
			suggestions.push('GitHub');
		}
		if (projectContext?.scmType === 'gitlab' || /gitlab|merge request/i.test(text)) {
			suggestions.push('GitLab');
		}
	}

	// Issue tracking suggestions
	if (/jira|ticket|issue|story|epic/i.test(text) || projectContext?.hasJira) {
		suggestions.push('Jira');
	}

	// Documentation suggestions
	if (/confluence|wiki|documentation|doc/i.test(text) || projectContext?.hasConfluence) {
		suggestions.push('Confluence');
	}

	// Language/tooling suggestions
	if (/test|build|npm|yarn|pnpm|typescript|ts\b/i.test(text)) {
		suggestions.push('TypeScript');
	}
	if (/python|pip|pytest|py\b/i.test(text)) {
		suggestions.push('Python');
	}

	// Web suggestions
	if (/fetch|http|api|url|web|search/i.test(text)) {
		suggestions.push('Web');
	}

	// Code editing suggestions
	if (/edit|modify|change|update|fix|refactor/i.test(text)) {
		suggestions.push('CodeEditor');
		suggestions.push('LiveFiles');
	}

	// Shell suggestions
	if (/run|execute|command|script|shell|bash/i.test(text)) {
		suggestions.push('CommandLine');
	}

	// Remove duplicates
	return [...new Set(suggestions)];
}

/**
 * Gets the token estimate for a tool group
 * (rough estimate based on typical schema sizes)
 */
export function estimateGroupTokens(groupName: string): number {
	const estimates: Record<string, number> = {
		FileSystem: 800,
		Agent: 600,
		Git: 1200,
		GitHub: 2000,
		GitLab: 1500,
		Web: 800,
		Jira: 1000,
		Confluence: 800,
		TypeScript: 600,
		Python: 500,
		CommandLine: 400,
		LiveFiles: 500,
		CodeEditor: 700,
	};

	return estimates[groupName] ?? 500;
}

/**
 * Calculates total token cost for a set of tool groups
 */
export function calculateToolTokens(groupNames: string[]): number {
	return groupNames.reduce((total, name) => total + estimateGroupTokens(name), 0);
}
