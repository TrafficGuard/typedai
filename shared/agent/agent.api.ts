import { Static, Type } from '@sinclair/typebox';
import { defineApiRoute } from '#shared/api-definitions';
import { ApiNullResponseSchema } from '../common.schema';
import { LlmCallSchema, LlmCallSummarySchema } from '../llmCall/llmCall.schema';
import {
	AgentActionBaseSchema,
	AgentActionByIdSchema,
	AgentCancelRequestSchema,
	AgentContextPreviewSchema,
	AgentContextSchema,
	AgentDeleteRequestSchema,
	AgentFeedbackRequestSchema,
	AgentIdParamsSchema,
	AgentResumeCompletedRequestSchema,
	AgentStartRequestSchema,
	AgentUpdateFunctionsRequestSchema,
	AutonomousIterationSchema,
	AutonomousIterationSummarySchema,
} from './agent.schema';

const AGENT_BASE = '/api/agent';

// Parameter Schemas for new routes
const AgentIterationParamsSchema = Type.Object({
	agentId: Type.String({ description: 'The ID of the agent' }),
	iterationNumber: Type.Number({ description: 'The iteration number' }),
});

const AgentLlmCallParamsSchema = Type.Object({
	agentId: Type.String({ description: 'The ID of the agent' }),
	llmCallId: Type.String({ description: 'The ID of the LLM call' }),
});

export const AGENT_API = {
	list: defineApiRoute('GET', `${AGENT_BASE}/list`, {
		schema: { response: { 200: Type.Array(AgentContextPreviewSchema) } },
	}),
	details: defineApiRoute('GET', `${AGENT_BASE}/details/:agentId`, {
		schema: { params: AgentIdParamsSchema, response: { 200: AgentContextSchema } },
	}),
	start: defineApiRoute('POST', `${AGENT_BASE}/start`, {
		schema: { body: AgentStartRequestSchema, response: { 201: AgentContextSchema } }, // 201 for resource creation
	}),
	delete: defineApiRoute('POST', `${AGENT_BASE}/delete`, {
		schema: { body: AgentDeleteRequestSchema, response: { 204: ApiNullResponseSchema } }, // 204 for no content
	}),

	forceStop: defineApiRoute('POST', `${AGENT_BASE}/force-stop`, {
		// Assuming executionId might not always be available or relevant for a hard stop
		schema: { body: AgentActionByIdSchema, response: { 200: ApiNullResponseSchema } }, // Or 204
	}),
	feedback: defineApiRoute('POST', `${AGENT_BASE}/feedback`, {
		schema: { body: AgentFeedbackRequestSchema, response: { 200: AgentContextSchema } },
	}),
	resumeError: defineApiRoute('POST', `${AGENT_BASE}/resume-error`, {
		schema: { body: AgentFeedbackRequestSchema, response: { 200: AgentContextSchema } },
	}),
	resumeHil: defineApiRoute('POST', `${AGENT_BASE}/resume-hil`, {
		schema: { body: AgentFeedbackRequestSchema, response: { 200: AgentContextSchema } },
	}),
	requestHil: defineApiRoute('POST', `${AGENT_BASE}/request-hil`, {
		schema: { body: AgentActionBaseSchema, response: { 200: AgentContextSchema } },
	}),
	cancel: defineApiRoute('POST', `${AGENT_BASE}/cancel`, {
		schema: { body: AgentCancelRequestSchema, response: { 200: AgentContextSchema } },
	}),
	resumeCompleted: defineApiRoute('POST', `${AGENT_BASE}/resume-completed`, {
		schema: { body: AgentResumeCompletedRequestSchema, response: { 200: AgentContextSchema } },
	}),
	updateFunctions: defineApiRoute('POST', `${AGENT_BASE}/update-functions`, {
		schema: { body: AgentUpdateFunctionsRequestSchema, response: { 200: AgentContextSchema } },
	}),

	getIterations: defineApiRoute('GET', `${AGENT_BASE}/iterations/:agentId`, {
		schema: { params: AgentIdParamsSchema, response: { 200: Type.Array(AutonomousIterationSchema) } },
	}),
	getLlmCallsByAgentId: defineApiRoute('GET', '/api/llms/calls/agent/:agentId', {
		schema: {
			params: AgentIdParamsSchema,
			// Using Type.Any() for LlmCall items as defining a full LlmCallSchema is out of scope for this refactoring.
			// The service will cast the items to LlmCall[].
			response: { 200: Type.Object({ data: Type.Array(Type.Any()) }) },
		},
	}),
	// Inside AGENT_API object:
	getAvailableFunctions: defineApiRoute('GET', `${AGENT_BASE}/functions`, {
		schema: { response: { 200: Type.Array(Type.String()) } }, // Using Type.Array(Type.String()) directly for robustness
	}),
	listHumanInLoopAgents: defineApiRoute('GET', `${AGENT_BASE}/list/humanInLoop`, {
		schema: { response: { 200: Type.Array(AgentContextSchema) } },
	}),
	listRunning: defineApiRoute('GET', `${AGENT_BASE}/list/running`, {
		schema: {
			response: {
				200: Type.Array(AgentContextPreviewSchema, {
					description: 'An array of agent context previews for running agents.',
				}),
			},
		},
	}),

	// New Endpoints for Iteration and LLM Call Summaries/Details
	getIterationSummaries: defineApiRoute('GET', `${AGENT_BASE}/iterations-summary/:agentId`, {
		schema: { params: AgentIdParamsSchema, response: { 200: Type.Array(AutonomousIterationSummarySchema) } },
	}),
	getIterationDetail: defineApiRoute('GET', `${AGENT_BASE}/iteration-detail/:agentId/:iterationNumber`, {
		schema: { params: AgentIterationParamsSchema, response: { 200: AutonomousIterationSchema } },
	}),
	getLlmCallSummaries: defineApiRoute('GET', `${AGENT_BASE}/llmcalls-summary/:agentId`, {
		schema: { params: AgentIdParamsSchema, response: { 200: Type.Array(LlmCallSummarySchema) } },
	}),
	getLlmCallDetail: defineApiRoute('GET', `${AGENT_BASE}/llmcall-detail/:agentId/:llmCallId`, {
		schema: { params: AgentLlmCallParamsSchema, response: { 200: LlmCallSchema } },
	}),
};
