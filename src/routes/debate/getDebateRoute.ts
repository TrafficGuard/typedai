import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendNotFound } from '#fastify/index';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';

export async function getDebateRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.getById, async (req, reply) => {
		const { debateId } = req.params;
		const debate = await fastify.debateStateService.getDebate(debateId);

		if (!debate) {
			return sendNotFound(reply, `Debate ${debateId} not found`);
		}

		reply.sendJSON(debate);
	});
}
