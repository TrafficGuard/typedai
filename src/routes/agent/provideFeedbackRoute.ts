import { serializeContext } from '#agent/agentSerialization';
import { provideFeedback } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function provideFeedbackRoute(fastify: AppFastifyInstance): Promise<void> {
	/** Provides feedback to an agent */
	registerApiRoute(fastify, AGENT_API.feedback, async (req, reply) => {
		const { agentId, feedback, executionId } = req.body;

		try {
			// provideFeedback should ideally handle agent existence/ownership or call a service method that does
			await provideFeedback(agentId!, executionId!, feedback!);
			// Load the updated agent to return the state
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error('Error providing feedback:', error);
			sendBadRequest(reply, 'Error providing feedback');
		}
	});
}
