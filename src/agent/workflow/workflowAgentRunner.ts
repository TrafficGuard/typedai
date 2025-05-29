import type { Span } from '@opentelemetry/api';
import { agentContext, agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import { type AgentExecution, type RunWorkflowConfig, agentExecutions } from '#agent/autonomous/autonomousAgentRunner';
import { appContext } from '#app/applicationContext';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { AgentContext } from '#shared/agent/agent.model';
import { errorToString } from '#utils/errors';
import { formatMillisDuration } from '#utils/time';

/**
 * Starts a workflow agent and returns the execution with the Promise of the running agent
 * @param config
 * @param workflow
 */
export async function startWorkflowAgent(config: RunWorkflowConfig, workflow: (agent: AgentContext) => any): Promise<AgentExecution> {
	let context: AgentContext = createContext(config);
	if (!config.llms) context.llms = defaultLLMs();
	await appContext().agentStateService.save(context);
	let execution: Promise<any>;

	const wrappedWorkflow = async () => {
		try {
			const start = Date.now();
			await withActiveSpan(config.agentName, async (span: Span) => {
				await workflow(context);
			});
			context = agentContext();
			context.state = 'completed';
			const duration = Date.now() - start;

			logger.info(`Completed. Cost $${context.cost.toFixed(context.cost > 1 ? 2 : 3)}. Time: ${formatMillisDuration(duration)}`);
		} catch (e) {
			logger.error(e);
			context = agentContext();
			context.state = 'error';
			context.error = errorToString(e);
		} finally {
			delete agentExecutions[context.agentId];
			await appContext().agentStateService.save(context);
		}
		return context.agentId;
	};

	agentContextStorage.run(context, () => {
		execution = wrappedWorkflow();
	});

	const agentExecution: AgentExecution = {
		agentId: context.agentId,
		execution,
	};
	agentExecutions[context.agentId] = agentExecution;

	return agentExecution;
}

/**
 * Runs a workflow agent to completion.
 * @param config
 * @param workflow
 * @returns the agentId
 */
export async function runWorkflowAgent(config: RunWorkflowConfig, workflow: (agent: AgentContext) => any): Promise<string> {
	const execution = await startWorkflowAgent(config, workflow);
	await execution.execution;
	return execution.agentId;
}
