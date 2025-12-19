import type { AppFastifyInstance } from '#app/applicationTypes';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';

export async function cancelDebateRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.cancel, async (req, reply) => {
		const { debateId } = req.params;

		// Delete the debate (which also deletes associated results via foreign key)
		await fastify.debateStateService.deleteDebate(debateId);

		reply.status(204).send();
	});
}
