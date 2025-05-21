import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContext, llms } from '#agent/agentContextLocalStorage';
import type { RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import type { AgentLLMs } from '#shared/model/agent.model';
import { selectFilesAgent } from '#swe/discovery/selectFilesAgentWithSearch';
import { parseProcessArgs } from './cli';

async function main() {
	const agentLLMs: AgentLLMs = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	const config: RunWorkflowConfig = {
		agentName: `Select Files: ${initialPrompt}`,
		subtype: 'select-files',
		llms: agentLLMs,
		functions: [], //FileSystem,
		initialPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	await runWorkflowAgent(config, async () => {
		const agent = agentContext();
		agent.name = `Query: ${await llms().easy.generateText(
			`<query>\n${initialPrompt}\n</query>\n\nSummarise the query into only a terse few words for a short title (8 words maximum) for the name of the AI agent completing the task. Output the short title only, nothing else.`,
			{ id: 'Agent name' },
		)}`;
		await appContext().agentStateService.save(agent);

		let response: any = await selectFilesAgent(initialPrompt);
		response = JSON.stringify(response);
		console.log(response);

		writeFileSync('src/cli/files-out', response);
		console.log('Wrote output to src/cli/files-out');
	});

	await shutdownTrace();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
