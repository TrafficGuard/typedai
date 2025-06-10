import { serializeContext } from '#agent/agentSerialization';
import { cancelAgent } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function cancelAgentRoute(fastify: AppFastifyInstance) {
	// Cancels an agent and sets it to the completed state
	registerApiRoute(fastify, AGENT_API.cancel, async (req, reply) => {
		const { agentId, executionId, reason } = req.body;
		try {
			// cancelAgent should ideally handle agent existence/ownership or call a service method that does
			await cancelAgent(agentId!, executionId!, reason!);
			// Load the updated agent to return the state
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error cancelling agent ${agentId}`);
			sendBadRequest(reply, 'Error cancelling agent');
		}
	});
}
