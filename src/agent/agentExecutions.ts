/**
 * The reference to a running agent
 */
export interface AgentExecution {
	agentId: string;
	execution: Promise<any>;
}

/**
 * The active running agents
 * key: agentId
 */
export const agentExecutions: Record<string, AgentExecution> = {};

export function isAgentExecuting(agentId: string): boolean {
	return agentExecutions[agentId] !== undefined;
}

/**
 * The agents that are in a human-in-the-loop check to continue
 * Key: agentId
 * Value: reason for the human-in-the-loop check and a function to resume the agent
 */
export const agentHumanInLoop: Record<string, { reason: string; resume: () => void }> = {};
