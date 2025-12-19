import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendNotFound } from '#fastify/index';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';

export async function getResultRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.getResult, async (req, reply) => {
		const { debateId } = req.params;
		const result = await fastify.debateStateService.getResult(debateId);

		if (!result) {
			return sendNotFound(reply, `Result for debate ${debateId} not found`);
		}

		reply.sendJSON(result);
	});
}
