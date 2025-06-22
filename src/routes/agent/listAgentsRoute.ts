import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AgentContextPreview } from '#shared/agent/agent.model';
import { registerApiRoute } from '../routeUtils';

export async function listAgentsRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, AGENT_API.list, async (req, reply) => {
		try {
			const agentPreviews: AgentContextPreview[] = await fastify.agentStateService.list();
			reply.sendJSON(agentPreviews);
		} catch (error) {
			logger.error(error, 'Error listing agents');
			send(reply, 500, { error: 'Failed to list agents' });
		}
	});
}
