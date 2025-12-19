import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest, sendNotFound } from '#fastify/index';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';
import type { DebatePhase } from '#shared/debate/debate.model';

/** Phases from which a debate can be paused */
const PAUSABLE_PHASES: DebatePhase[] = ['initial', 'debate', 'consensus', 'synthesis', 'verification'];

export async function pauseDebateRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.pause, async (req, reply) => {
		const { debateId } = req.params;

		// Get current state to validate phase
		const current = await fastify.debateStateService.getDebate(debateId);

		if (!current) {
			return sendNotFound(reply, `Debate ${debateId} not found`);
		}

		if (!PAUSABLE_PHASES.includes(current.phase)) {
			return sendBadRequest(reply, `Cannot pause debate in phase: ${current.phase}`);
		}

		const updated = await fastify.debateStateService.updateDebate(debateId, {
			phase: 'paused',
			previousPhase: current.phase, // Store current phase for resume
		});

		reply.sendJSON(updated);
	});
}
