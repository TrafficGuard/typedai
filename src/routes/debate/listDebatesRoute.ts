import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';
import type { DebateListQuerySchema } from '#shared/debate/debate.schema';

type DebateListQuery = Static<typeof DebateListQuerySchema>;

export async function listDebatesRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.list, async (req, reply) => {
		const query = req.query as DebateListQuery;
		const result = await fastify.debateStateService.listDebates(undefined, query.startAfterId, query.limit);
		reply.sendJSON(result);
	});
}
