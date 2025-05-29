import type { AgentContext, AgentContextPreview, AgentRunningState, AutonomousIteration, AutonomousIterationSummary } from '#shared/agent/agent.model';

export interface AgentContextService {
	save(state: AgentContext): Promise<void>;
	updateState(ctx: AgentContext, state: AgentRunningState): Promise<void>;
	load(agentId: string): Promise<AgentContext | null>;

	/**
	 * For autonomous agents, requests a human-in-the-loop check from the user after the current iteration
	 * @param agent
	 */
	requestHumanInLoopCheck(agent: AgentContext): Promise<void>;

	list(): Promise<AgentContextPreview[]>;
	/**
	 * List agents which are not in a completed state
	 */
	listRunning(): Promise<AgentContextPreview[]>;

	clear(): void;

	/**
	 * Delete agents by their IDs
	 * @param ids Array of agent IDs to delete
	 */
	delete(ids: string[]): Promise<void>;

	/**
	 * Updates the function an agent has available to use
	 * @param agentId
	 * @param functions the function class names
	 */
	updateFunctions(agentId: string, functions: string[]): Promise<void>;

	/**
	 * Saves the details of a single autonomous agent iteration.
	 * @param iterationData The data for the iteration.
	 */
	saveIteration(iterationData: AutonomousIteration): Promise<void>;

	/**
	 * Loads all iterations for a given agent.
	 * @param agentId The ID of the agent.
	 * @returns An array of AutonomousIteration objects, ordered by iteration number.
	 */
	loadIterations(agentId: string): Promise<AutonomousIteration[]>;

	/**
	 * Gets summaries of all iterations for a given agent.
	 * @param agentId The ID of the agent.
	 * @returns An array of AutonomousIterationSummary objects.
	 */
	getAgentIterationSummaries(agentId: string): Promise<AutonomousIterationSummary[]>;

	/**
	 * Gets the detailed data for a specific agent iteration.
	 * @param agentId The ID of the agent.
	 * @param iterationNumber The iteration number.
	 * @returns An AutonomousIteration object or null if not found.
	 */
	getAgentIterationDetail(agentId: string, iterationNumber: number): Promise<AutonomousIteration | null>;
}
