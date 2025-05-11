import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { RunAgentConfig, RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { GitLab } from '#functions/scm/gitlab';
import { defaultLLMs } from '#llm/services/defaultLlms';
import type { AgentLLMs } from '#shared/model/agent.model';
import { contentText, messageText } from '#shared/model/llm.model';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { beep } from '#utils/beep';
import { parseProcessArgs, saveAgentId } from './cli';
import { parsePromptWithImages } from './promptParser';

async function main() {
	const agentLlms: AgentLLMs = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt: rawPrompt, resumeAgentId } = parseProcessArgs();
	const { textPrompt, userContent } = parsePromptWithImages(rawPrompt);

	console.log(`Prompt: ${textPrompt}`); // Log the text part

	const config: RunWorkflowConfig = {
		agentName: 'cli-code',
		subtype: 'code',
		llms: agentLlms,
		functions: [GitLab], //FileSystem,
		initialPrompt: textPrompt, // Use the parsed text prompt for config/logging if needed elsewhere
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	const agentId = await runWorkflowAgent(config, async () => {
		// Pass the full UserContent (text + images) to the agent
		await new CodeEditingAgent().implementUserRequirements(contentText(userContent));
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
