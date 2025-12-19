import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest, sendNotFound } from '#fastify/index';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';

export async function resumeDebateRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.resume, async (req, reply) => {
		const { debateId } = req.params;

		// Get current state to determine what phase to resume to
		const current = await fastify.debateStateService.getDebate(debateId);

		if (!current) {
			return sendNotFound(reply, `Debate ${debateId} not found`);
		}

		if (current.phase !== 'paused') {
			return sendBadRequest(reply, `Cannot resume debate in phase: ${current.phase}`);
		}

		// Resume to the phase the debate was in before being paused
		const resumePhase = current.previousPhase ?? 'debate';
		const updated = await fastify.debateStateService.updateDebate(debateId, {
			phase: resumePhase,
			previousPhase: undefined, // Clear previousPhase after resume
		});

		reply.sendJSON(updated);
	});
}
