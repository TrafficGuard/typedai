import type { Span } from '@opentelemetry/api';
import { agentContext, agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import { type AgentExecution, agentExecutions } from '#agent/autonomous/autonomousAgentRunner';
import { type RunWorkflowConfig } from '#agent/autonomous/runAgentTypes';
import { appContext } from '#app/applicationContext';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { AgentContext } from '#shared/agent/agent.model';
import { sleep } from '#utils/async-utils';
import { errorToString } from '#utils/errors';
import { formatMillisDuration } from '#utils/time';

/**
 * Starts a workflow agent and returns the execution with the Promise of the running agent
 * @param config
 * @param workflow
 */
export async function startWorkflowAgent(config: RunWorkflowConfig, workflow: (agent: AgentContext) => any): Promise<AgentExecution> {
	let agent: AgentContext = createContext(config);
	if (!config.llms) agent.llms = defaultLLMs();
	await appContext().agentStateService.save(agent);
	let execution: Promise<any> | undefined;

	const wrappedWorkflow = async () => {
		try {
			const start = Date.now();
			await withActiveSpan(config.agentName, async (span: Span) => {
				await workflow(agent);
			});
			agent = agentContext()!;
			agent.state = 'completed';
			const duration = Date.now() - start;

			logger.info(`Completed. Cost $${agent.cost.toFixed(agent.cost > 1 ? 2 : 3)}. Time: ${formatMillisDuration(duration)}`);
		} catch (e) {
			logger.error(e);
			agent = agentContext()!;
			agent.state = 'error';
			agent.error = errorToString(e);
		} finally {
			delete agentExecutions[agent.agentId];
			await appContext().agentStateService.save(agent);
		}
		return agent.agentId;
	};

	agentContextStorage.run(agent, () => {
		execution = wrappedWorkflow();
	});
	await sleep(10);

	const agentExecution: AgentExecution = {
		agentId: agent.agentId,
		execution: execution!,
	};
	agentExecutions[agent.agentId] = agentExecution;

	return agentExecution;
}

/**
 * Runs a workflow agent to completion.
 * @param config
 * @param workflow
 * @returns the agentId
 */
export async function runWorkflowAgent(config: RunWorkflowConfig, workflow: (agent: AgentContext) => any): Promise<string> {
	const wrappers: (agent: AgentContext) => any = (agent) => {};
	const execution = await startWorkflowAgent(config, workflow);
	await execution.execution;
	return execution.agentId;
}
