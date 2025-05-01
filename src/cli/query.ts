import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContext, llms } from '#agent/agentContextLocalStorage';
import type { AgentLLMs } from '#agent/agentContextTypes';
import type { RunAgentConfig, RunWorkflowConfig } from '#agent/agentRunner';
import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { queryWorkflow } from '#swe/discovery/selectFilesAgent';
import { parseProcessArgs, saveAgentId } from './cli';

async function main() {
	const agentLLMs: AgentLLMs = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	const config: RunWorkflowConfig = {
		agentName: 'Query',
		subtype: 'workflow',
		llms: agentLLMs,
		functions: [],
		initialPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	const agentId = await runAgentWorkflow(config, async () => {
		const agent = agentContext();
		agent.name = `Query: ${await llms().easy.generateText(
			`<query>\n${initialPrompt}\n</query>\n\nSummarise the query into only a terse few words for a short title (8 words maximum) for the name of the AI agent completing the task. Output the short title only, nothing else.`,
			{ id: 'Agent name' },
		)}`;
		await appContext().agentStateService.save(agent);

		const response: any = await queryWorkflow(initialPrompt);
		console.log(response);

		writeFileSync('src/cli/query-out', response);
		console.log('Wrote output to src/cli/query-out');
	});

	if (agentId) {
		saveAgentId('query', agentId);
	}

	await shutdownTrace();
}

main().catch(console.error);
