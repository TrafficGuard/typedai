import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContext } from '#agent/agentContext';
import { getFileSystem, llms } from '#agent/agentContextUtils';
import type { RunWorkflowConfig } from '#agent/autonomous/runAgentTypes';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { generateFileSystemTreeWithSummaries } from '#swe/summaries/repositoryMap';
import { loadBuildDocsSummaries } from '#swe/summaries/summaryBuilder';
import { parseProcessArgs, saveAgentId } from './cli';

/**
 * CLI command to generate a file system tree with summaries.
 *
 * Usage:
 *   file-tree                                    Show full tree with file summaries
 *   file-tree "Find authentication files"       Collapse irrelevant folders
 *
 * Flags:
 *   -r   Resume from previous agent
 */
async function main() {
	await initApplicationContext();
	const agentLLMs: AgentLLMs = defaultLLMs();
	const { initialPrompt: rawPrompt, resumeAgentId } = parseProcessArgs();

	const query = rawPrompt.trim();

	if (query) {
		console.log(`Query: ${query}`);
		console.log('Irrelevant folders will be collapsed');
	}

	const config: RunWorkflowConfig = {
		agentName: 'File Tree',
		subtype: 'file-tree',
		llms: agentLLMs,
		functions: [],
		initialPrompt: query || 'Generate full file tree',
		resumeAgentId,
		humanInLoop: {
			budget: 0,
		},
	};

	const agentId = await runWorkflowAgent(config, async () => {
		const agent = agentContext()!;
		agent.name = 'File Tree';
		await appContext().agentStateService.save(agent);

		// Load summaries
		console.log('Loading repository summaries...');
		const summaries = await loadBuildDocsSummaries();

		// Determine which folders to collapse (only if query provided)
		let collapsedFolders: string[] = [];
		if (query) {
			console.log('Analyzing folder relevance...');
			collapsedFolders = await determineIrrelevantFolders(query, summaries, agentLLMs);
			console.log(`Collapsing ${collapsedFolders.length} irrelevant folders`);
		}

		// Generate the tree with file summaries
		console.log('Generating file tree...');
		const tree = await generateFileSystemTreeWithSummaries(summaries, true, collapsedFolders);

		// Output
		console.log(`\n${'='.repeat(80)}`);
		console.log('FILE TREE:');
		console.log('='.repeat(80));
		console.log(tree);

		agent.output = tree;

		// Write to file
		writeFileSync('src/cli/file-tree-out.txt', tree);
		logger.info('Wrote output to src/cli/file-tree-out.txt');
	});

	if (agentId) {
		saveAgentId('file-tree', agentId);
	}

	await shutdownTrace();
	process.exit(0);
}

/**
 * Uses an LLM to determine which folders are not relevant to the given task.
 */
async function determineIrrelevantFolders(task: string, summaries: Map<string, Summary>, agentLLMs: AgentLLMs): Promise<string[]> {
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

interface Summary {
	path: string;
	short: string;
	long: string;
}

main().catch(console.error);
