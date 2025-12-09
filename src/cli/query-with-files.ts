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
import { queryWithFileSelection2 } from '#swe/discovery/selectFilesAgentWithSearch';
import { parseProcessArgs, saveAgentId } from './cli';
import { parsePromptWithImages } from './promptParser';

/**
 * CLI command to query a codebase and get both an answer and the list of files analyzed.
 *
 * Usage:
 *   ai query-with-files "How is authentication implemented?"
 *   ai query-with-files --xhr "Explain the complete architecture"
 *   ai query-with-files --initial-files=src/auth.ts "What does this connect to?"
 *
 * Flags:
 *   --xhr                        Use extra-hard LLM for complex queries
 *   --initial-files=file1,file2  Initial file paths to include
 *   -r                           Resume from previous agent
 */
async function main() {
	await initApplicationContext();
	const agentLLMs: AgentLLMs = defaultLLMs();
	const { initialPrompt: rawPrompt, resumeAgentId, flags } = parseProcessArgs();
	const { textPrompt } = await parsePromptWithImages(rawPrompt);

	if (!textPrompt.trim()) {
		console.error('Error: Please provide a query');
		console.error('Usage: ai query-with-files "your question about the codebase"');
		process.exit(1);
	}

	const useXhard: boolean = !!flags.xhr && !!llms().xhard;
	if (flags.xhr && !useXhard) {
		logger.warn('Xhard LLM not configured. Using standard hard LLM.');
	}

	// Parse initial files flag
	const initialFilePaths: string[] = [];
	if (flags['initial-files'] && typeof flags['initial-files'] === 'string') {
		initialFilePaths.push(...flags['initial-files'].split(',').map((f) => f.trim()));
	}

	console.log(`Query: ${textPrompt}`);
	if (useXhard) {
		console.log('Using extra-hard LLM for complex query');
	}
	if (initialFilePaths.length > 0) {
		console.log(`Initial files: ${initialFilePaths.join(', ')}`);
	}

	const config: RunWorkflowConfig = {
		agentName: 'Query with Files',
		subtype: 'query-with-files',
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
		agent.name = `Query+Files: ${await llms().easy.generateText(
			`<query>\n${textPrompt}\n</query>\n\nSummarise the query into only a terse few words for a short title (8 words maximum). Output the short title only, nothing else.`,
			{ id: 'Agent name' },
		)}`;
		await appContext().agentStateService.save(agent);

		// Query with file selection
		const { files, answer } = await queryWithFileSelection2(textPrompt, {
			useXtraHardLLM: useXhard,
			initialFilePaths: initialFilePaths.length > 0 ? initialFilePaths : undefined,
		});

		// Get VCS info
		const vcs = getFileSystem().getVcs();
		let headSha = '';
		if (vcs) {
			headSha = `\nHEAD SHA: ${await vcs.getHeadSha()}`;
		}

		// Output results
		console.log(`\n${'='.repeat(80)}`);
		console.log('ANSWER:');
		console.log('='.repeat(80));
		console.log(answer);

		console.log(`\n${'='.repeat(80)}`);
		console.log('FILES ANALYZED:');
		console.log('='.repeat(80));
		console.log(JSON.stringify(files, null, 2));

		// Compose full response
		const response = `${answer}\n\n<files>\n${JSON.stringify(files, null, 2)}\n</files>${headSha}`;
		agent.output = response;

		// Write to file
		writeFileSync('src/cli/query-with-files-out.md', response);
		console.log('\nWrote output to src/cli/query-with-files-out.md');
	});

	if (agentId) {
		saveAgentId('query-with-files', agentId);
	}

	await shutdownTrace();
}

main().catch(console.error);
