import { serializeContext } from '#agent/agentSerialization';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AgentContext, AgentContextPreview } from '#shared/agent/agent.model';
import { registerApiRoute } from '../routeUtils';

export async function listHumanInLoopAgentsRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, AGENT_API.listHumanInLoopAgents, async (req, reply) => {
		try {
			const agentPreviews: AgentContextPreview[] = await fastify.agentStateService.listRunning();
			const agentContextsPromises = agentPreviews.map(async (preview) => {
				try {
					// Use load here, which now throws NotFound/NotAllowed
					return await fastify.agentStateService.load(preview.agentId);
				} catch (error) {
					// Log and skip agents that can't be loaded (e.g., deleted between listRunning and load)
					logger.warn(`Agent with ID ${preview.agentId} found in running list but failed to load: ${error.message}`);
					return null;
				}
			});
			const agentContextsNullable = await Promise.all(agentContextsPromises);
			const agentContextsFull = agentContextsNullable.filter((ctx): ctx is AgentContext => ctx !== null);

			const response = agentContextsFull
				.filter((ctx) => ctx.state === 'hitl_threshold' || ctx.state === 'hitl_tool' || ctx.state === 'hitl_feedback')
				.map(serializeContext);
			reply.sendJSON(response);
		} catch (error) {
			// Handle potential errors from listRunning or load calls
			logger.error(error, 'Error listing human-in-the-loop agents');
			send(reply, 500, { error: 'Failed to list human-in-the-loop agents' });
		}
	});
}
