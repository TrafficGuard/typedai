import { AgentCompleted, AgentContext } from '#agent/agentContextTypes';
import { FunctionCallResult } from '#llm/llm';
import { logger } from '#o11y/logger';
import { envVar } from '#utils/env-var';

/**
 * Runs the completionHandler on an agent
 * @param agent
 */
export async function runAgentCompleteHandler(agent: AgentContext): Promise<void> {
	try {
		const completionHandler = agent.completedHandler ?? new ConsoleCompletedHandler();
		await completionHandler.notifyCompleted(agent);
	} catch (e) {
		logger.warn(e, `Completion handler error for agent ${agent.agentId}`);
		throw e;
	}
}

/**
 * Creates a generic notification message for the completion of an agent execution
 * @param agent
 */
export function completedNotificationMessage(agent: AgentContext) {
	const uiUrl = envVar('UI_URL');
	let message = stateNotificationMessage(agent);
	message += `\n${uiUrl}/ui/agents/${agent.agentId}`;
	return message;
}

/**
 * Outputs the standard agent completion message to the console
 */
export class ConsoleCompletedHandler implements AgentCompleted {
	notifyCompleted(agentContext: AgentContext): Promise<void> {
		console.log(completedNotificationMessage(agentContext));
		return Promise.resolve();
	}

	agentCompletedHandlerId(): string {
		return 'console';
	}
}

export function stateNotificationMessage(agent: AgentContext): string {
	switch (agent.state) {
		case 'error':
			return `Agent error.\nName:${agent.name}\nError: ${agent.error}`;
		case 'hil':
			return `Agent has reached Human-in-the-loop threshold.\nName: ${agent.name}`;
		case 'feedback':
			return `Agent has requested feedback.\nName: ${agent.name}\n:Question: ${getLastFunctionCallArg(agent)}`;
		case 'completed':
			return `Agent has completed.\nName: ${agent.name}\nNote: ${getLastFunctionCallArg(agent)}`;
		default:
	}
}

export function getLastFunctionCallArg(agent: AgentContext) {
	const result: FunctionCallResult = agent.functionCallHistory.slice(-1)[0];
	return Object.values(result.parameters)[0];
}
