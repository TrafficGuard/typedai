import { forceStopAgent } from '#agent/forceStopAgent';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function forceStopAgentRoute(fastify: AppFastifyInstance) {
	/** Forcibly stop an agent */
	registerApiRoute(fastify, AGENT_API.forceStop, async (req, reply) => {
		const { agentId } = req.body;
		try {
			// forceStopAgent should ideally handle agent existence/ownership or call a service method that does
			await forceStopAgent(agentId);
			send(reply, 200, null);
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error force stopping agent ${agentId}`);
			sendBadRequest(reply, 'Error force stopping agent');
		}
	});
}
