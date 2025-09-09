import { Type } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendNotFound } from '#fastify/index';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { AGENT_API } from '#shared/agent/agent.api';
import type { LlmCall, LlmCallSummary } from '#shared/llmCall/llmCall.model';

const basePath = '/api/llms'; // This might be '/api/agent/v1' if all agent related llm calls are there
// However, AGENT_API.getLlmCallsByAgentId uses /api/llms path.
// New routes for summaries/details are defined under AGENT_BASE_V1 in AGENT_API.

export async function llmCallRoutes(fastify: AppFastifyInstance): Promise<void> {
	fastify.get(
		`${basePath}/calls/agent/:agentId`,
		{
			schema: {
				params: Type.Object({
					agentId: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const { agentId } = req.params;
			const llmCalls: LlmCall[] = await fastify.llmCallService.getLlmCallsForAgent(agentId);
			// AGENT_API.getLlmCallsByAgentId schema expects { data: LlmCall[] }
			// but current implementation sends LlmCall[] directly.
			// For consistency with schema, it should be: reply.sendJSON({ data: llmCalls });
			// However, I will keep it as is to not break existing behavior unless specified.
			send(reply, 200, llmCalls);
		},
	);

	// Endpoint to get LLM call summaries for an agent
	registerApiRoute(fastify, AGENT_API.getLlmCallSummaries, async (req, reply) => {
		const { agentId } = req.params;
		try {
			const summaries: LlmCallSummary[] = await fastify.llmCallService.getLlmCallSummaries(agentId);
			reply.sendJSON(summaries);
		} catch (error) {
			logger.error(error, `Error loading LLM call summaries for agent ${agentId}`);
			send(reply, 500, { error: 'Failed to load LLM call summaries' });
		}
	});

	// Endpoint to get a specific LLM call detail
	// The path from AGENT_API.getLlmCallDetail includes agentId, so we use that.
	registerApiRoute(fastify, AGENT_API.getLlmCallDetail, async (req, reply) => {
		const { agentId, llmCallId } = req.params; // agentId might be used for authorization/scoping in service
		try {
			const llmCallDetail: LlmCall | null = await fastify.llmCallService.getLlmCallDetail(llmCallId);
			if (!llmCallDetail) {
				return sendNotFound(reply, `LLM call ${llmCallId} not found.`);
			}
			reply.sendJSON(llmCallDetail);
		} catch (error) {
			logger.error(error, `Error loading LLM call ${llmCallId}`);
			send(reply, 500, { error: 'Failed to load LLM call detail' });
		}
	});
}
