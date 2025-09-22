import { agentExecutions } from '#agent/agentExecutions';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AgentContext, AgentContextPreview } from '#shared/agent/agent.model';
import { toAgentContextPreview } from '#shared/agent/agent.utils';
import { registerApiRoute } from '../routeUtils';

// An agent might still be in agentExecutions during its final moments (e.g., promise.finally cleanup).
// We only want to show agents that are genuinely active and not in a terminal state.
const TERMINAL_STATES = ['completed', 'error', 'cancelled'];

export async function listRunningAgentsRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, AGENT_API.listRunning, async (req, reply): Promise<void> => {
		try {
			const runningAgentIds = Object.keys(agentExecutions);
			if (runningAgentIds.length === 0) return reply.sendJSON([]);

			const agentPromises = runningAgentIds.map(async (id): Promise<AgentContext | null> => {
				try {
					return await fastify.agentStateService.load(id);
				} catch (error) {
					// This can happen if an agent is removed between getting the keys and loading.
					logger.warn(error, `Failed to load running agent context for ID: ${id}. It may have been removed.`);
					return null; // Return null on failure so Promise.all doesn't reject the entire request.
				}
			});
			const agents = await Promise.all(agentPromises);

			// Filter out failed loads and agents in terminal states, then map to preview.
			const runningPreviews: AgentContextPreview[] = agents
				.filter((agent): agent is AgentContext => agent !== null && !TERMINAL_STATES.includes(agent.state))
				.map(toAgentContextPreview);

			reply.sendJSON(runningPreviews);
		} catch (error) {
			logger.error(error, 'Error listing running agents');
			send(reply, 500, { error: 'Failed to list running agents' });
		}
	});
}
