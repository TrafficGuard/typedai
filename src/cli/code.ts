import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { AgentLLMs } from '#agent/agentContextTypes';
import type { RunAgentConfig } from '#agent/agentRunner';
import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { GitLab } from '#functions/scm/gitlab';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { beep } from '#utils/beep';
import { initApplicationContext } from '../applicationContext';
import { parseProcessArgs, saveAgentId } from './cli';

async function main() {
	const agentLlms: AgentLLMs = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	const config: RunAgentConfig = {
		agentName: 'cli-code',
		llms: agentLlms,
		functions: [GitLab], //FileSystem,
		initialPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	const agentId = await runAgentWorkflow(config, async () => {
		await new CodeEditingAgent().implementUserRequirements(config.initialPrompt);
		// await (agentContext().functions.getFunctionInstanceMap().Agent as Agent).saveMemory('memKey', 'content');
		// return llms().easy.generateText('What colour is the sky. Respond in one word.');
	});

	if (agentId) {
		saveAgentId('code', agentId);
	}

	await beep();
	await shutdownTrace();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
