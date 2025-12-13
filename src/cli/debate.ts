import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContext } from '#agent/agentContext';
import { llms } from '#agent/agentContextUtils';
import type { RunWorkflowConfig } from '#agent/autonomous/runAgentTypes';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { MAD_Balanced4 } from '#llm/multi-agent/reasoning-debate';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { messageText } from '#shared/llm/llm.model';
import { parseProcessArgs } from './cli';
import { parsePromptWithImages } from './promptParser';

async function main() {
	await initApplicationContext();
	const agentLLMs: AgentLLMs = defaultLLMs();
	const { initialPrompt: rawPrompt, resumeAgentId, flags } = parseProcessArgs();
	const { textPrompt, userContent } = await parsePromptWithImages(rawPrompt);

	console.log(`Prompt: ${textPrompt}`);

	const config: RunWorkflowConfig = {
		agentName: 'Debate',
		subtype: 'debate',
		llms: agentLLMs,
		functions: [],
		initialPrompt: textPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	await runWorkflowAgent(config, async () => {
		const agent = agentContext()!;
		agent.name = `Query: ${await llms().easy.generateText(
			`<query>\n${textPrompt}\n</query>\n\nSummarise the query into only a terse few words for a short title (8 words maximum) for the name of the AI agent completing the task. Output the short title only, nothing else.`,
			{ id: 'Agent name' },
		)}`;
		await appContext().agentStateService.save(agent);

		const message = await MAD_Balanced4().generateMessage(textPrompt, { id: 'debate', thinking: 'low' });
		const text = messageText(message);
		agent.output = text;

		writeFileSync('src/cli/debate-out.md', text);
		console.log(text);
		console.log('Wrote output to src/cli/debate-out.md');
	});

	await shutdownTrace();
}

main().catch(console.error);
