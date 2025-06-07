import { Type } from '@sinclair/typebox';
import { serializeContext } from '#agent/agentSerialization';
import { type AgentExecution, agentExecutions } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AgentContext, AgentContextPreview, AutonomousIteration, AutonomousIterationSummary } from '#shared/agent/agent.model';
import { NotAllowed, NotFound } from '#shared/errors';
import { functionRegistry } from '../../functionRegistry';
import { registerApiRoute } from '../routeUtils';

export async function agentDetailsRoutes(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, AGENT_API.list, async (req, reply) => {
		try {
			const agentPreviews: AgentContextPreview[] = await fastify.agentStateService.list();
			reply.sendJSON(agentPreviews);
		} catch (error) {
			logger.error(error, 'Error listing agents');
			send(reply, 500, { error: 'Failed to list agents' });
		}
	});

	registerApiRoute(fastify, AGENT_API.getAvailableFunctions, async (req, reply) => {
		const functionNames = functionRegistry().map((t) => t.name);
		reply.sendJSON(functionNames);
	});

	registerApiRoute(fastify, AGENT_API.listHumanInLoopAgents, async (req, reply) => {
		try {
			const agentPreviews: AgentContextPreview[] = await fastify.agentStateService.listRunning();
			const agentContextsPromises = agentPreviews.map(async (preview) => {
				try {
					// Use load here, which now throws NotFound/NotAllowed
					return await fastify.agentStateService.load(preview.agentId);
				} catch (error) {
					// Log and skip agents that can't be loaded (e.g., deleted between listRunning and load)
					logger.warn(`Agent with ID ${preview.agentId} found in running list but failed to load: ${error.message}`);
					return null;
				}
			});
			const agentContextsNullable = await Promise.all(agentContextsPromises);
			const agentContextsFull = agentContextsNullable.filter((ctx): ctx is AgentContext => ctx !== null);

			const response = agentContextsFull
				.filter((ctx) => ctx.state === 'hitl_threshold' || ctx.state === 'hitl_tool' || ctx.state === 'hitl_feedback')
				.map(serializeContext);
			reply.sendJSON(response);
		} catch (error) {
			// Handle potential errors from listRunning or load calls
			logger.error(error, 'Error listing human-in-the-loop agents');
			send(reply, 500, { error: 'Failed to list human-in-the-loop agents' });
		}
	});

	registerApiRoute(fastify, AGENT_API.details, async (req, reply) => {
		const { agentId } = req.params;
		try {
			const agentContext: AgentContext = await fastify.agentStateService.load(agentId);
			// No need for: if (!agentContext) { ... } as load now throws
			const response = serializeContext(agentContext);
			reply.sendJSON(response);
		} catch (error) {
			if (error instanceof NotFound) {
				return sendNotFound(reply, error.message);
			}
			if (error instanceof NotAllowed) {
				return send(reply, 403, { error: error.message });
			}
			logger.error(error, `Error loading details for agent ${agentId} [error]`);
			return send(reply, 500, { error: 'Failed to load agent details' });
		}
	});

	// Endpoint to get iterations for an agent
	registerApiRoute(fastify, AGENT_API.getIterations, async (req, reply) => {
		const { agentId } = req.params;
		try {
			// service.loadIterations now handles agent existence and ownership check internally
			const iterations: AutonomousIteration[] = await fastify.agentStateService.loadIterations(agentId);
			reply.sendJSON(iterations);
		} catch (error) {
			if (error instanceof NotFound) {
				return sendNotFound(reply, error.message);
			}
			if (error instanceof NotAllowed) {
				return send(reply, 403, { error: error.message });
			}
			logger.error(error, `Error loading iterations for agent ${agentId} [error]`);
			// Send a generic server error, or more specific if possible
			send(reply, 500, { error: 'Failed to load agent iterations' });
		}
	});

	// Endpoint to get iteration summaries for an agent
	registerApiRoute(fastify, AGENT_API.getIterationSummaries, async (req, reply) => {
		const { agentId } = req.params;
		try {
			// service.getAgentIterationSummaries now handles agent existence and ownership check internally
			const summaries: AutonomousIterationSummary[] = await fastify.agentStateService.getAgentIterationSummaries(agentId);
			reply.sendJSON(summaries);
		} catch (error) {
			if (error instanceof NotFound) {
				return sendNotFound(reply, error.message);
			}
			if (error instanceof NotAllowed) {
				return send(reply, 403, { error: error.message });
			}
			logger.error(error, `Error loading iteration summaries for agent ${agentId} [error]`);
			send(reply, 500, { error: 'Failed to load agent iteration summaries' });
		}
	});

	// Endpoint to get a specific iteration detail for an agent
	registerApiRoute(fastify, AGENT_API.getIterationDetail, async (req, reply) => {
		const { agentId, iterationNumber } = req.params;
		try {
			// service.getAgentIterationDetail now handles agent/iteration existence and ownership check internally
			const iterationDetail: AutonomousIteration = await fastify.agentStateService.getAgentIterationDetail(agentId, iterationNumber);
			// No need for: if (!iterationDetail) { ... } as getAgentIterationDetail now throws
			reply.sendJSON(iterationDetail);
		} catch (error) {
			if (error instanceof NotFound) {
				return sendNotFound(reply, error.message);
			}
			if (error instanceof NotAllowed) {
				return send(reply, 403, { error: error.message });
			}
			logger.error(error, `Error loading iteration ${iterationNumber} for agent ${agentId} [error]`);
			send(reply, 500, { error: 'Failed to load agent iteration detail' });
		}
	});

	registerApiRoute(fastify, AGENT_API.delete, async (req, reply) => {
		const { agentIds } = req.body;
		try {
			// The service.delete method handles ownership and state checks internally
			await fastify.agentStateService.delete(agentIds ?? []);
			reply.code(204).send(); // For ApiNullResponseSchema
		} catch (error) {
			// Delete might throw other errors, but not typically NotFound/NotAllowed for individual IDs in the list
			logger.error('Error deleting agents:', error);
			sendBadRequest(reply, 'Error deleting agents');
		}
	});

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
