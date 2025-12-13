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
import { queryWorkflowWithSearch } from '#swe/discovery/selectFilesAgentWithSearch';
import { parseProcessArgs, saveAgentId } from './cli';
import { parsePromptWithImages } from './promptParser';

/**
 * CLI command to query a codebase and get a detailed answer with citations.
 *
 * Usage:
 *   ai query-codebase "How does the authentication system work?"
 *   ai query-codebase --xhr "Explain the complete data flow architecture"
 *
 * Flags:
 *   --xhr   Use extra-hard LLM for complex queries (slower but more accurate)
 *   -r      Resume from previous agent
 */
async function main() {
	await initApplicationContext();
	const agentLLMs: AgentLLMs = defaultLLMs();
	const { initialPrompt: rawPrompt, resumeAgentId, flags } = parseProcessArgs();
	const { textPrompt } = await parsePromptWithImages(rawPrompt);

	if (!textPrompt.trim()) {
		console.error('Error: Please provide a query');
		console.error('Usage: ai query-codebase "your question about the codebase"');
		process.exit(1);
	}

	const useXhard: boolean = !!flags.xhr && !!llms().xhard;
	if (flags.xhr && !useXhard) {
		logger.warn('Xhard LLM not configured. Using standard hard LLM.');
	}

	console.log(`Query: ${textPrompt}`);
	if (useXhard) {
		console.log('Using extra-hard LLM for complex query');
	}

	const config: RunWorkflowConfig = {
		agentName: 'Query Codebase',
		subtype: 'query-codebase',
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
		agent.name = `Query: ${await llms().easy.generateText(
			`<query>\n${textPrompt}\n</query>\n\nSummarise the query into only a terse few words for a short title (8 words maximum). Output the short title only, nothing else.`,
			{ id: 'Agent name' },
		)}`;
		await appContext().agentStateService.save(agent);

		// Query the codebase
		const answer = await queryWorkflowWithSearch(textPrompt, { useHardLLM: useXhard });

		// Output results
		console.log(`\n${'='.repeat(80)}`);
		console.log('ANSWER:');
		console.log('='.repeat(80));
		console.log(answer);

		agent.output = answer;

		// Write to file
		writeFileSync('src/cli/query-codebase-out.md', answer);
		console.log('\nWrote output to src/cli/query-codebase-out.md');
	});

	if (agentId) {
		saveAgentId('query-codebase', agentId);
	}

	await shutdownTrace();
}

main().catch(console.error);
