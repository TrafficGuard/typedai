import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { LlmFunctions } from '#agent/LlmFunctions';
import { AgentFeedback } from '#agent/orchestrator/functions/agentFeedback';
import { waitForConsoleInput } from '#agent/orchestrator/humanInTheLoop';
import { provideFeedback, resumeCompleted, resumeError, resumeHil, startAgent } from '#agent/orchestrator/orchestratorAgentRunner';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { parseProcessArgs, saveAgentId } from './cli';
import { resolveFunctionClasses } from './functionResolver';

export async function main() {
	const llms = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId, functionClasses } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	if (resumeAgentId) {
		const agent = await appContext().agentStateService.load(resumeAgentId);
		switch (agent.state) {
			case 'completed':
				return await resumeCompleted(resumeAgentId, agent.executionId, initialPrompt);
			case 'error':
				return resumeError(resumeAgentId, agent.executionId, initialPrompt);
			case 'hitl_threshold':
			case 'hitl_tool':
				return await resumeHil(resumeAgentId, agent.executionId, initialPrompt);
			case 'hitl_feedback':
				return await provideFeedback(resumeAgentId, agent.executionId, initialPrompt);
			default:
				await waitForConsoleInput(`Agent is currently in the state ${agent.state}. Only resume if you know it is not `);
				return resumeError(resumeAgentId, agent.executionId, initialPrompt);
		}
	}

	let functions: LlmFunctions | Array<new () => any>;
	if (functionClasses?.length) {
		functions = await resolveFunctionClasses(functionClasses);
	} else {
		// Default to FileSystemRead if no functions specified
		functions = [FileSystemRead];
	}
	functions.push(AgentFeedback);
	logger.info(`Available tools ${functions.map((f) => f.name).join(', ')}`);

	logger.info('Starting new agent');
	const execution = await startAgent({
		agentName: 'cli-agent',
		initialPrompt,
		functions,
		llms,
		type: 'orchestrator',
		subtype: 'codegen',
		resumeAgentId,
		humanInLoop: {
			count: 30,
			budget: 30,
		},
	});
	saveAgentId('agent', execution.agentId);
	await execution.execution;
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
