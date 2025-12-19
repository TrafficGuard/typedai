import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { DEBATE_API } from '#shared/debate/debate.api';
import type { DebateStreamEvent } from '#shared/debate/debate.model';

/**
 * SSE streaming endpoint for debate events.
 *
 * This route provides real-time updates about the debate progress.
 * The actual debate orchestration would be handled by a DebateCoordinator
 * that emits events through an event emitter or similar mechanism.
 *
 * For the initial implementation, this provides the SSE infrastructure.
 * The coordinator integration will be added as a follow-up.
 */
export async function streamDebateRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, DEBATE_API.stream, async (req, reply) => {
		const { debateId } = req.params;

		// Verify debate exists
		const debate = await fastify.debateStateService.getDebate(debateId);
		if (!debate) {
			return sendNotFound(reply, `Debate ${debateId} not found`);
		}

		// Setup CORS + SSE headers using reply.hijack() for raw streaming
		const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
		const uiOrigin = requestOrigin ?? (process.env.UI_URL ? new URL(process.env.UI_URL).origin : undefined);

		reply.hijack();
		reply.raw.writeHead(200, {
			...(uiOrigin
				? {
						'Access-Control-Allow-Origin': uiOrigin,
						'Access-Control-Allow-Credentials': 'true',
						Vary: 'Origin',
					}
				: {}),
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no',
		});

		// Helper to send SSE events
		const sse = (event: DebateStreamEvent) => {
			reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
		};

		// Send initial event with current state
		sse({ type: 'debate-started', debateId: debate.debateId, topic: debate.topic });

		// If debate is already complete, send the result and close
		if (debate.phase === 'complete') {
			const result = await fastify.debateStateService.getResult(debateId);
			if (result) {
				sse({ type: 'debate-complete', result });
			}
			reply.raw.end();
			return;
		}

		// If debate has an error, send it and close
		if (debate.phase === 'error') {
			sse({ type: 'error', message: debate.error ?? 'Unknown error' });
			reply.raw.end();
			return;
		}

		// TODO: Subscribe to DebateCoordinator events for this debate
		// The coordinator would emit events like:
		// - round-started
		// - agent-thinking
		// - agent-position-delta
		// - agent-tool-call
		// - agent-tool-result
		// - agent-position-complete
		// - round-complete
		// - hitl-requested
		// - synthesis-started
		// - verification-started
		// - verification-claim
		// - debate-complete
		// - error

		// For now, send a placeholder event indicating the stream is connected
		// The actual debate orchestration will be implemented separately
		logger.info({ debateId }, 'Client connected to debate stream');

		// Keep the connection alive with periodic heartbeats
		const heartbeatInterval = setInterval(() => {
			try {
				reply.raw.write(':heartbeat\n\n');
			} catch (e) {
				clearInterval(heartbeatInterval);
			}
		}, 30000);

		reply.raw.on('close', () => {
			clearInterval(heartbeatInterval);
			logger.info({ debateId }, 'Client disconnected from debate stream');
			// TODO: Cleanup any subscriptions to debate coordinator
		});
	});
}
