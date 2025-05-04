import type { Span } from '@opentelemetry/api';
import { agentContext, agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import type { AgentContext } from '#agent/agentContextTypes';
import { runCodeGenAgent } from '#agent/orchestrator/codegen/codegenOrchestratorAgent';
import { type AgentExecution, RunAgentConfig, type RunWorkflowConfig, agentExecutions } from '#agent/orchestrator/orchestratorAgentRunner';
import { runXmlAgent } from '#agent/orchestrator/xml/xmlOrchestratorAgent';
import { appContext } from '#app/applicationContext';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { errorToString } from '#utils/errors';
import { formatMillisDuration } from '#utils/time';

async function startWorkflowAgent(agent: AgentContext): Promise<AgentExecution> {
	let execution: AgentExecution;

	switch (agent.subtype) {
		case 'xml':
			execution = await runXmlAgent(agent);
			break;
		case 'codegen':
			execution = await runCodeGenAgent(agent);
			break;
		default:
			throw new Error(`Invalid agent type ${agent.type}`);
	}

	agentExecutions[agent.agentId] = execution;
	execution.execution.finally(() => {
		delete agentExecutions[agent.agentId];
	});
	return execution;
}

/**
 * Runs a workflow with an agentContext. This also persists the agent so its actions can be reviewed in the UI
 * @param config
 * @param workflow
 * @returns the agentId
 */
export async function runAgentWorkflow(config: RunWorkflowConfig, workflow: (agent: AgentContext) => any): Promise<string> {
	let context: AgentContext = createContext(config);
	context.state = 'workflow';
	await appContext().agentStateService.save(context);

	return agentContextStorage.run(context, async () => {
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
			await appContext().agentStateService.save(context);
		}
		return context.agentId;
	});
}
