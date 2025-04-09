import type { AgentContext, AgentRunningState } from '#agent/agentContextTypes';

export interface AgentStateService {
	save(state: AgentContext): Promise<void>;
	updateState(ctx: AgentContext, state: AgentRunningState): Promise<void>;
	load(agentId: string): Promise<AgentContext | null>;
	list(): Promise<AgentContext[]>;
	/**
	 * List agents which are not in a completed state
	 */
	listRunning(): Promise<AgentContext[]>;

	clear(): void;

	/**
	 * Delete agents by their IDs
	 * @param ids Array of agent IDs to delete
	 */
	delete(ids: string[]): Promise<void>;

	updateFunctions(agentId: string, functions: string[]): Promise<void>;
}
