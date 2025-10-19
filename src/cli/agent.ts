import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { provideFeedback, resumeCompleted, resumeError, resumeHil, startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { AgentFeedback } from '#agent/autonomous/functions/agentFeedback';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { humanInTheLoop } from '#agent/autonomous/humanInTheLoop';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { FileSystemWrite } from '#functions/storage/fileSystemWrite';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/agent/agent.model';
import { registerErrorHandlers } from '../errorHandlers';
import { parseProcessArgs, saveAgentId } from './cli';
import { loadCliEnvironment } from './envLoader';
import { resolveFunctionClasses } from './functionAliases';

export async function main(): Promise<void> {
	loadCliEnvironment();
	registerErrorHandlers();
	await initApplicationContext();
	const llms = defaultLLMs();

	// llms.hard = llms.medium;

	const { initialPrompt, resumeAgentId, functionClasses } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	if (resumeAgentId) {
		const agent = await appContext().agentStateService.load(resumeAgentId);
		if (!agent) throw new Error(`No agent exists with id ${resumeAgentId}`);
		await resumeAgent(agent, resumeAgentId, initialPrompt);
		console.log('Resume this agent by running:');
		console.log(`ai codeAgent -r=${agent.agentId}`);
		return;
	}

	let functions: LlmFunctionsImpl | Array<new () => any>;
	if (functionClasses?.length) {
		functions = await resolveFunctionClasses(functionClasses);
	} else {
		// Default to FileSystemRead if no functions specified
		functions = [FileSystemTree, LiveFiles];
	}
	functions.push(AgentFeedback);
	logger.info(`Available tools ${functions.map((f) => f.name).join(', ')}`);

	logger.info('Starting new agent');
	const execution = await startAgent({
		agentName: 'cli-agent',
		initialPrompt,
		functions,
		llms,
		type: 'autonomous',
		subtype: 'codegen',
		resumeAgentId,
		humanInLoop: {
			count: 30,
			budget: 5,
		},
	});
	saveAgentId('agent', execution.agentId);
	try {
		await execution.execution;
	} catch (e) {
		console.log(e);
	}

	console.log('Resume this agent by running:');
	console.log(`ai agent -r=${execution.agentId}`);
	console.log(`https://localhost:4200/ui/agent/${execution.agentId}`);
}

async function resumeAgent(agent: AgentContext, resumeAgentId: string, initialPrompt: string) {
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
			await humanInTheLoop(agent, `Agent is currently in the state ${agent.state}. Only resume if you know it is not `);
			return resumeError(resumeAgentId, agent.executionId, initialPrompt);
	}
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
