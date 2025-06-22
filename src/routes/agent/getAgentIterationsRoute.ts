import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AutonomousIteration } from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function getAgentIterationsRoute(fastify: AppFastifyInstance) {
	// Endpoint to get iterations for an agent
	registerApiRoute(fastify, AGENT_API.getIterations, async (req, reply) => {
		const { agentId } = req.params;
		try {
			// service.loadIterations now handles agent existence and ownership check internally
			const iterations: AutonomousIteration[] = await fastify.agentStateService.loadIterations(agentId);
			reply.sendJSON(iterations);
		} catch (error) {
			if (error instanceof NotFound) {
				return sendNotFound(reply, error.message);
			}
			if (error instanceof NotAllowed) {
				return send(reply, 403, { error: error.message });
			}
			logger.error(error, `Error loading iterations for agent ${agentId} [error]`);
			// Send a generic server error, or more specific if possible
			send(reply, 500, { error: 'Failed to load agent iterations' });
		}
	});
}
