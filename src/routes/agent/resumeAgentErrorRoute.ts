import { serializeContext } from '#agent/agentSerialization';
import { resumeError } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function resumeAgentErrorRoute(fastify: AppFastifyInstance): Promise<void> {
	/** Resumes an agent in the error state */
	registerApiRoute(fastify, AGENT_API.resumeError, async (req, reply) => {
		const { agentId, executionId, feedback } = req.body;
		try {
			// resumeError should ideally handle agent existence/ownership or call a service method that does
			await resumeError(agentId!, executionId!, feedback!);
			// Load the updated agent to return the state
			const updatedAgent = await fastify.agentStateService.load(agentId!);
			if (!updatedAgent) return sendNotFound(reply, `Agent ${agentId} not found`);
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error resuming error agent ${agentId}`);
			sendBadRequest(reply, 'Error resuming error agent');
		}
	});
}
