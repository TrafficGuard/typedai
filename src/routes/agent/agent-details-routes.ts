import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import { serializeContext } from '#agent/agentSerialization';
import { type AgentExecution, agentExecutions } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendSuccess } from '#fastify/index';
import { sendJSON } from '#fastify/responses';
import { logger } from '#o11y/logger';
import type { AgentContext, AutonomousIteration } from '#shared/model/agent.model';
import { functionRegistry } from '../../functionRegistry';

const basePath = '/api/agent/v1';

export async function agentDetailsRoutes(fastify: AppFastifyInstance) {
	fastify.get(`${basePath}/list`, {}, async (req, reply) => {
		const ctxs: AgentContext[] = await fastify.agentStateService.list();
		const response = ctxs.map(serializeContext);
		send(reply as FastifyReply, 200, response);
	});

	fastify.get(`${basePath}/functions`, {}, async (req, reply) => {
		send(
			reply as FastifyReply,
			200,
			functionRegistry().map((t) => t.name),
		);
	});

	fastify.get(`${basePath}/list/humanInLoop`, {}, async (req, reply) => {
		const ctxs: AgentContext[] = await fastify.agentStateService.listRunning();
		const response = ctxs.filter((ctx) => ctx.state === 'hitl_threshold' || ctx.state === 'hitl_tool' || ctx.state === 'hitl_feedback').map(serializeContext);
		send(reply, 200, response);
	});

	fastify.get(
		`${basePath}/details/:agentId`,
		{
			schema: {
				params: Type.Object({
					agentId: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const agentId = req.params.agentId;
			const ctx: AgentContext = await fastify.agentStateService.load(agentId);
			if (!ctx) return sendBadRequest(reply);
			const serializedContext = serializeContext(ctx);
			serializedContext.functions = ctx.functions.getFunctionClassNames().filter((name) => name !== 'Agent');
			send(reply, 200, serializedContext);
		},
	);

	// Endpoint to get iterations for an agent
	fastify.get(
		`${basePath}/iterations/:agentId`,
		{
			schema: {
				params: Type.Object({
					agentId: Type.String(),
				}),
				// Define response schema if needed for validation/documentation
				// response: {
				// 	200: Type.Array(AutonomousIterationSchema) // Assuming AutonomousIterationSchema exists
				// }
			},
		},
		async (req, reply) => {
			const agentId = req.params.agentId;
			try {
				// Optional: Check if agent exists first?
				// const agentExists = await fastify.agentContextService.load(agentId);
				// if (!agentExists) return sendNotFound(reply, `Agent ${agentId} not found`);

				const iterations: AutonomousIteration[] = await fastify.agentStateService.loadIterations(agentId);
				sendJSON(reply, iterations);
			} catch (error) {
				logger.error(error, `Error loading iterations for agent ${agentId}`);
				// Send a generic server error, or more specific if possible
				send(reply, 500, { error: 'Failed to load agent iterations' });
			}
		},
	);

	fastify.post(
		`${basePath}/delete`,
		{
			schema: {
				body: Type.Object({
					agentIds: Type.Array(Type.String()),
				}),
			},
		},
		async (req, reply) => {
			const { agentIds } = req.body;
			try {
				await fastify.agentStateService.delete(agentIds);
				sendSuccess(reply, 'Agents deleted successfully');
			} catch (error) {
				logger.error('Error deleting agents:', error);
				sendBadRequest(reply, 'Error deleting agents');
			}
		},
	);

	// Server-Send Events route for real-time agent updates
	fastify.get(
		`${basePath}/listen/:agentId`,
		{
			schema: {
				params: Type.Object({
					agentId: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const agentId = req.params.agentId;
			const agentExecution: AgentExecution = agentExecutions[agentId];
			if (!agentExecution) {
				return sendBadRequest(reply);
			}

			reply.raw.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'Access-Control-Allow-Origin': '*', // Need to set CORS headers
				'Access-Control-Allow-Credentials': 'true',
			});

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
