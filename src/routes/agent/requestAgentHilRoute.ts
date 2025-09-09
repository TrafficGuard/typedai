import { serializeContext } from '#agent/agentSerialization';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import { isExecuting } from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function requestAgentHilRoute(fastify: AppFastifyInstance): Promise<void> {
	/** Requests a human-in-the-loop check for an agent */
	registerApiRoute(fastify, AGENT_API.requestHil, async (req, reply) => {
		const { agentId, executionId } = req.body;

		try {
			const agent = await fastify.agentStateService.load(agentId!); // load now throws NotFound/NotAllowed
			if (!agent) return sendNotFound(reply, `Agent ${agentId} not found`);
			if (agent.executionId !== executionId)
				return sendBadRequest(reply, `Execution ID mismatch. Agent ${agentId} is currently on execution ${agent.executionId}.`);

			if (agent.hilRequested) {
				logger.info(`HIL check already requested for agent ${agentId}, execution ${executionId}.`);
				return send(reply, 200, serializeContext(agent));
			}

			if (!isExecuting(agent)) return sendBadRequest(reply, `Agent ${agentId} is not in an executing state (${agent.state}). Cannot request HIL check.`);

			await fastify.agentStateService.requestHumanInLoopCheck(agent);

			const updatedAgent = (await fastify.agentStateService.load(agentId!))!;
			reply.sendJSON(serializeContext(updatedAgent));
		} catch (error: any) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error({ agentId, executionId, error }, 'Error requesting HIL check [error]');
			sendBadRequest(reply, `Error requesting HIL check: ${error.message || 'Unknown error'}`);
		}
	});
}
