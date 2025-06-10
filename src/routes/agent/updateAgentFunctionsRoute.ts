import { serializeContext } from '#agent/agentSerialization';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function updateAgentFunctionsRoute(fastify: AppFastifyInstance) {
	/** Updates the functions available to an agent */
	registerApiRoute(fastify, AGENT_API.updateFunctions, async (req, reply) => {
		const { agentId, functions } = req.body;

		try {
			await fastify.agentStateService.updateFunctions(agentId!, functions!);
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			const serialized = serializeContext(updatedAgent);
			reply.sendJSON(serialized);
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, 'Error updating agent functions [error]');
			sendBadRequest(reply, 'Error updating agent functions');
		}
	});
}
