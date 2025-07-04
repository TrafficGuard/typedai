import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContext, llms } from '#agent/agentContextLocalStorage';
import type { RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { queryWithFileSelection2 } from '#swe/discovery/selectFilesAgentWithSearch';
import { parseProcessArgs, saveAgentId } from './cli';
import { parsePromptWithImages } from './promptParser';

async function main() {
	await initApplicationContext();
	const agentLLMs: AgentLLMs = defaultLLMs();
	const { initialPrompt: rawPrompt, resumeAgentId } = parseProcessArgs();
	const { textPrompt, userContent } = parsePromptWithImages(rawPrompt);

	console.log(`Prompt: ${textPrompt}`);

	const config: RunWorkflowConfig = {
		agentName: 'Query',
		subtype: 'query',
		llms: agentLLMs,
		functions: [],
		initialPrompt: textPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	const agentId = await runWorkflowAgent(config, async () => {
		const agent = agentContext();
		// Use textPrompt for generating the agent name summary
		agent.name = `Query: ${await llms().easy.generateText(
			`<query>\n${textPrompt}\n</query>\n\nSummarise the query into only a terse few words for a short title (8 words maximum) for the name of the AI agent completing the task. Output the short title only, nothing else.`,
			{ id: 'Agent name' },
		)}`;
		await appContext().agentStateService.save(agent);

		// Pass the text part of the prompt to the query workflow
		const { files, answer } = await queryWithFileSelection2(textPrompt);
		console.log(JSON.stringify(files));
		console.log(answer);

		const response = `${answer}\n\n<json>\n${JSON.stringify(files)}\n</json>`;

		agent.output = response;

		writeFileSync('src/cli/query-out.md', response);
		console.log('Wrote output to src/cli/query-out.md');
	});

	if (agentId) {
		saveAgentId('query', agentId);
	}

	await shutdownTrace();
}

main().catch(console.error);
