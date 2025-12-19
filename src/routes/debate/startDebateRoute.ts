import { randomUUID } from 'node:crypto';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';
import type { DebateState } from '#shared/debate/debate.model';
import { currentUser } from '#user/userContext';

export async function startDebateRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.start, async (req, reply) => {
		const { topic, backgroundContext, debaters, maxRounds, hitlEnabled } = req.body;
		const userId = currentUser().id;

		// Create the initial debate state
		const debateState: DebateState = {
			debateId: randomUUID(),
			userId,
			topic,
			backgroundContext,
			phase: 'initial',
			currentRound: 1,
			rounds: [],
			debaters,
			config: {
				maxRounds: maxRounds ?? 5,
				hitlEnabled: hitlEnabled ?? true,
			},
			startTime: Date.now(),
		};

		// Save the debate
		const created = await fastify.debateStateService.createDebate(debateState);

		// Return the created debate - the actual orchestration is started
		// when the client connects to the stream endpoint
		// sendJSON will auto-select 201 based on route schema
		reply.sendJSON(created);
	});
}
