import { serializeContext } from '#agent/agentSerialization';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AgentContext } from '#shared/agent/agent.model';
import { AgentContextApi } from '#shared/agent/agent.schema';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function getAgentDetailsRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, AGENT_API.details, async (req, reply) => {
		const { agentId } = req.params;
		try {
			const agentContext: AgentContext = await fastify.agentStateService.load(agentId);
			// No need for: if (!agentContext) { ... } as load now throws
			const response: AgentContextApi = serializeContext(agentContext);
			reply.sendJSON(response);
		} catch (error) {
			if (error instanceof NotFound) {
				return sendNotFound(reply, error.message);
			}
			if (error instanceof NotAllowed) {
				return send(reply, 403, { error: error.message });
			}
			logger.error(error, `Error loading details for agent ${agentId} [error]`);
			return send(reply, 500, { error: 'Failed to load agent details' });
		}
	});
}
