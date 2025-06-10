import { serializeContext } from '#agent/agentSerialization';
import { resumeCompleted } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function resumeAgentCompletedRoute(fastify: AppFastifyInstance) {
	/** Resumes an agent in the completed state */
	registerApiRoute(fastify, AGENT_API.resumeCompleted, async (req, reply) => {
		const { agentId, executionId, instructions } = req.body;

		try {
			await resumeCompleted(agentId!, executionId!, instructions!);
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, 'Error resuming completed agent');
			sendBadRequest(reply, 'Error resuming completed agent');
		}
	});
}
