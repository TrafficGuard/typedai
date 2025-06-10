import { serializeContext } from '#agent/agentSerialization';
import { resumeHil } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function resumeAgentHilRoute(fastify: AppFastifyInstance) {
	/** Resumes an agent in the hil (human in the loop) state */
	registerApiRoute(fastify, AGENT_API.resumeHil, async (req, reply) => {
		const { agentId, executionId, feedback } = req.body;
		try {
			// resumeHil should ideally handle agent existence/ownership or call a service method that does
			await resumeHil(agentId!, executionId!, feedback!);
			const updatedAgent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			send(reply, 200, serializeContext(updatedAgent));
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error resuming HIL agent ${agentId}`);
			sendBadRequest(reply, 'Error resuming HIL agent');
		}
	});
}
