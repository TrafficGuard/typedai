import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AutonomousIteration } from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function getAgentIterationDetailRoute(fastify: AppFastifyInstance): Promise<void> {
	// Endpoint to get a specific iteration detail for an agent
	registerApiRoute(fastify, AGENT_API.getIterationDetail, async (req, reply) => {
		const { agentId, iterationNumber } = req.params;
		try {
			// service.getAgentIterationDetail now handles agent/iteration existence and ownership check internally
			const iterationDetail: AutonomousIteration | null = await fastify.agentStateService.getAgentIterationDetail(agentId, iterationNumber);
			if (!iterationDetail) return sendNotFound(reply, `Iteration ${iterationNumber} not found for agent ${agentId}`);

			// No need for: if (!iterationDetail) { ... } as getAgentIterationDetail now throws
			reply.sendJSON(iterationDetail);
		} catch (error) {
			if (error instanceof NotFound) return sendNotFound(reply, error.message);
			if (error instanceof NotAllowed) return send(reply, 403, { error: error.message });
			logger.error(error, `Error loading iteration ${iterationNumber} for agent ${agentId} [error]`);
			send(reply, 500, { error: 'Failed to load agent iteration detail' });
		}
	});
}
