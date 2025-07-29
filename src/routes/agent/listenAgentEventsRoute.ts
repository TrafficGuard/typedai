import { Type } from '@sinclair/typebox';
import { type AgentExecution, agentExecutions } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendNotFound } from '#fastify/index';

export async function listenAgentEventsRoute(fastify: AppFastifyInstance): Promise<void> {
	// Server-Send Events route for real-time agent updates
	fastify.get(
		'/api/agent/v1/listen/:agentId',
		{
			schema: {
				params: Type.Object({
					agentId: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const agentId = req.params.agentId;
			// Note: This endpoint doesn't check user ownership of the agent execution stream.
			// A proper implementation might need to verify the user is authorised to listen.
			const agentExecution: AgentExecution = agentExecutions[agentId];
			if (!agentExecution) {
				// Use NotFound here as the execution stream doesn't exist
				return sendNotFound(reply, `Agent execution stream for ID ${agentId} not found.`);
			}

			reply.raw.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Access-Control-Allow-Origin': '*', // Need to set CORS headers
				'Access-Control-Allow-Credentials': 'true',
			});

			// Keep the existing logic for sending completion/error events
			agentExecution.execution
				.then((result) => {
					reply.raw.write(`data: ${JSON.stringify({ event: 'completed', agentId })}\n\n`);
					reply.raw.end();
				})
				.catch((error) => {
					reply.raw.write(`data: ${JSON.stringify({ event: 'error', agentId, error })}\n\n`);
					reply.raw.end();
				});
		},
	);
}
