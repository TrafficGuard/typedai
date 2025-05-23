import { type Static, Type } from '@sinclair/typebox';
import { serializeContext } from '#agent/agentSerialization';
import { type AgentExecution, agentExecutions } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest } from '#fastify/index';
import { logger } from '#o11y/logger';
import { AGENT_API } from '#shared/api/agent.api';
import type { AgentContext, AgentContextPreview, AutonomousIteration } from '#shared/model/agent.model';
import { functionRegistry } from '../../functionRegistry';

export async function agentDetailsRoutes(fastify: AppFastifyInstance) {
	fastify.get(AGENT_API.list.pathTemplate, { schema: AGENT_API.list.schema }, async (req, reply) => {
		const agentPreviews: AgentContextPreview[] = await fastify.agentStateService.list();
		// The agentPreviews are already in the format defined by AgentContextPreviewSchema.
		// No further transformation or serialization like `serializeContext` is needed.
		reply.sendJSON(agentPreviews);
	});

	fastify.get(AGENT_API.getAvailableFunctions.pathTemplate, { schema: AGENT_API.getAvailableFunctions.schema }, async (req, reply) => {
		reply.sendJSON(functionRegistry().map((t) => t.name));
	});

	fastify.get(AGENT_API.listHumanInLoopAgents.pathTemplate, { schema: AGENT_API.listHumanInLoopAgents.schema }, async (req, reply) => {
		const agentPreviews: AgentContextPreview[] = await fastify.agentStateService.listRunning();
		const agentContextsPromises = agentPreviews.map(async (preview) => {
			const fullContext = await fastify.agentStateService.load(preview.agentId);
			if (!fullContext) {
				logger.error(`Agent with ID ${preview.agentId} found in preview list but not loaded by agentStateService.load().`);
				return null;
			}
			return fullContext;
		});
		const agentContextsNullable = await Promise.all(agentContextsPromises);
		const agentContextsFull = agentContextsNullable.filter((ctx): ctx is AgentContext => ctx !== null);

		const response = agentContextsFull
			.filter((ctx) => ctx.state === 'hitl_threshold' || ctx.state === 'hitl_tool' || ctx.state === 'hitl_feedback')
			.map(serializeContext);
		reply.sendJSON(response);
	});

	fastify.get(AGENT_API.details.pathTemplate, { schema: AGENT_API.details.schema }, async (req, reply) => {
		const { agentId } = req.params;
		const agentContext: AgentContext | null = await fastify.agentStateService.load(agentId);
		if (!agentContext) {
			return sendBadRequest(reply, `Agent with ID ${agentId} not found.`);
		}
		const response = serializeContext(agentContext);
		reply.sendJSON(response);
	});

	// Endpoint to get iterations for an agent
	fastify.get(AGENT_API.getIterations.pathTemplate, { schema: AGENT_API.getIterations.schema }, async (req, reply) => {
		const { agentId } = req.params;
		try {
			// Optional: Check if agent exists first?
			// const agentExists = await fastify.agentContextService.load(agentId);
			// if (!agentExists) return sendNotFound(reply, `Agent ${agentId} not found`);

			const iterations: AutonomousIteration[] = await fastify.agentStateService.loadIterations(agentId);
			// Assuming agentStateService.loadIterations returns AutonomousIteration[]
			// where memory and toolState are already Records as per the model definition.
			// If they were Maps, Object.fromEntries would be needed here.
			// const responseIterations = iterations.map((iter) => ({
			// 	...iter,
			// 	memory: Object.fromEntries(iter.memory), // Keep if service returns Maps
			// 	toolState: Object.fromEntries(iter.toolState), // Keep if service returns Maps
			// }));
			// If service returns Records (as per model), no conversion needed:
			reply.sendJSON(iterations);
		} catch (error) {
			logger.error(error, `Error loading iterations for agent ${agentId}`);
			// Send a generic server error, or more specific if possible
			send(reply, 500, { error: 'Failed to load agent iterations' });
		}
	});

	fastify.post(AGENT_API.delete.pathTemplate, { schema: AGENT_API.delete.schema }, async (req, reply) => {
		const { agentIds } = req.body;
		try {
			await fastify.agentStateService.delete(agentIds ?? []);
			reply.code(204).send(); // For ApiNullResponseSchema
		} catch (error) {
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
