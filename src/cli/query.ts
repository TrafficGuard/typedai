import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContext, getFileSystem, llms } from '#agent/agentContextLocalStorage';
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

async function main() {
	await initApplicationContext();
	const agentLLMs: AgentLLMs = defaultLLMs();
	const { initialPrompt: rawPrompt, resumeAgentId, flags } = parseProcessArgs();
	const { textPrompt, userContent } = await parsePromptWithImages(rawPrompt);

	const useXhard: boolean = !!flags.xhr && !!llms().xhard;
	if (flags.xhr && !useXhard) {
		logger.error('Xhard LLM not cofigured. Check defaultLLMs.ts');
		return;
	}

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
		const agent = agentContext()!;
		// Use textPrompt for generating the agent name summary
		agent.name = `Query: ${await llms().easy.generateText(
			`<query>\n${textPrompt}\n</query>\n\nSummarise the query into only a terse few words for a short title (8 words maximum) for the name of the AI agent completing the task. Output the short title only, nothing else.`,
			{ id: 'Agent name' },
		)}`;
		await appContext().agentStateService.save(agent);

		// Pass the text part of the prompt to the query workflow
		const { files, answer } = await queryWithFileSelection2(textPrompt, { useHardLLM: useXhard });
		console.log(JSON.stringify(files));
		console.log(answer);

		const vcs = getFileSystem().getVcs();
		let headSha = '';
		if (vcs) headSha = `\nHEAD SHA: ${await vcs.getHeadSha()}`;

		const response = `${answer}\n\n<json>\n${JSON.stringify(files)}\n</json>${headSha}`;

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
