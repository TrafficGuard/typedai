import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AutonomousIterationSummary } from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors';
import { registerApiRoute } from '../routeUtils';

export async function getAgentIterationSummariesRoute(fastify: AppFastifyInstance): Promise<void> {
	// Endpoint to get iteration summaries for an agent
	registerApiRoute(fastify, AGENT_API.getIterationSummaries, async (req, reply) => {
		const { agentId } = req.params;
		try {
			// service.getAgentIterationSummaries now handles agent existence and ownership check internally
			const summaries: AutonomousIterationSummary[] = await fastify.agentStateService.getAgentIterationSummaries(agentId);
			reply.sendJSON(summaries);
		} catch (error) {
			if (error instanceof NotFound) {
				return sendNotFound(reply, error.message);
			}
			if (error instanceof NotAllowed) {
				return send(reply, 403, { error: error.message });
			}
			logger.error(error, `Error loading iteration summaries for agent ${agentId} [error]`);
			send(reply, 500, { error: 'Failed to load agent iteration summaries' });
		}
	});
}
