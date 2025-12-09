import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContext } from '#agent/agentContext';
import { llms } from '#agent/agentContextUtils';
import type { RunWorkflowConfig } from '#agent/autonomous/runAgentTypes';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { selectFilesAgent } from '#swe/discovery/selectFilesAgentWithSearch';
import { parseProcessArgs, saveAgentId } from './cli';
import { parsePromptWithImages } from './promptParser';

/**
 * CLI command to select files from a codebase for a given task or requirement.
 *
 * Usage:
 *   ai select-files "Find all files related to authentication"
 *   ai select-files --initial-files=src/auth.ts "Find related config files"
 *
 * Flags:
 *   --initial-files=file1,file2  Initial file paths to include
 *   --json                       Output as JSON (default)
 *   -r                           Resume from previous agent
 */
async function main() {
	await initApplicationContext();
	const agentLLMs: AgentLLMs = defaultLLMs();
	const { initialPrompt: rawPrompt, resumeAgentId, flags } = parseProcessArgs();
	const { textPrompt } = await parsePromptWithImages(rawPrompt);

	if (!textPrompt.trim()) {
		console.error('Error: Please provide a requirements description');
		console.error('Usage: ai select-files "description of what files are needed"');
		process.exit(1);
	}

	// Parse initial files flag
	const initialFilePaths: string[] = [];
	if (flags['initial-files'] && typeof flags['initial-files'] === 'string') {
		initialFilePaths.push(...flags['initial-files'].split(',').map((f) => f.trim()));
	}

	console.log(`Requirements: ${textPrompt}`);
	if (initialFilePaths.length > 0) {
		console.log(`Initial files: ${initialFilePaths.join(', ')}`);
	}

	const config: RunWorkflowConfig = {
		agentName: 'Select Files',
		subtype: 'select-files',
		llms: agentLLMs,
		functions: [],
		initialPrompt: textPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	const agentId = await runWorkflowAgent(config, async () => {
		const agent = agentContext()!;

		// Generate short name for the agent
		agent.name = `Select Files: ${await llms().easy.generateText(
			`<requirements>\n${textPrompt}\n</requirements>\n\nSummarise the requirements into only a terse few words for a short title (8 words maximum). Output the short title only, nothing else.`,
			{ id: 'Agent name' },
		)}`;
		await appContext().agentStateService.save(agent);

		// Select files
		const files = await selectFilesAgent(textPrompt, {
			initialFilePaths: initialFilePaths.length > 0 ? initialFilePaths : undefined,
		});

		// Output results
		const output = JSON.stringify(files, null, 2);
		console.log('\nSelected files:');
		console.log(output);

		agent.output = output;

		// Write to file
		writeFileSync('src/cli/select-files-out.json', output);
		console.log('\nWrote output to src/cli/select-files-out.json');
	});

	if (agentId) {
		saveAgentId('select-files', agentId);
	}

	await shutdownTrace();
}

main().catch(console.error);
