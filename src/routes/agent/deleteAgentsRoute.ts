import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { registerApiRoute } from '../routeUtils';

export async function deleteAgentsRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, AGENT_API.delete, async (req, reply) => {
		const { agentIds } = req.body;
		try {
			// The service.delete method handles ownership and state checks internally
			await fastify.agentStateService.delete(agentIds ?? []);
			reply.code(204).send(); // For ApiNullResponseSchema
		} catch (error) {
			// Delete might throw other errors, but not typically NotFound/NotAllowed for individual IDs in the list
			logger.error('Error deleting agents:', error);
			sendBadRequest(reply, 'Error deleting agents');
		}
	});
}
