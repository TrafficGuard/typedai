import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest, sendNotFound } from '#fastify/index';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';

export async function submitHitlRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.submitHitl, async (req, reply) => {
		const { debateId } = req.params;
		const decision = req.body;

		// Get current debate state
		const debate = await fastify.debateStateService.getDebate(debateId);

		if (!debate) {
			return sendNotFound(reply, `Debate ${debateId} not found`);
		}

		if (debate.phase !== 'hitl') {
			return sendBadRequest(reply, `Debate is not in HITL phase. Current phase: ${debate.phase}`);
		}

		// Validate that either selectedAgentId or customAnswer is provided
		if (!decision.selectedAgentId && !decision.customAnswer) {
			return sendBadRequest(reply, 'Either selectedAgentId or customAnswer must be provided');
		}

		// Store the HITL decision and transition to synthesis phase
		// The actual processing would happen in the DebateCoordinator
		const updated = await fastify.debateStateService.updateDebate(debateId, {
			phase: 'synthesis',
			hitlDecision: decision, // Persist the human decision
		});

		reply.sendJSON(updated);
	});
}
