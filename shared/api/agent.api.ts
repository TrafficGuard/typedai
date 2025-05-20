import { defineRoute } from '#shared/api-definitions';
import {
    AgentContextSchema,
    AutonomousIterationSchema,
    AgentIdParamsSchema,
    AgentFeedbackRequestSchema,
    AgentStartRequestSchema,
    AgentActionBaseSchema,
    AgentCancelRequestSchema,
    AgentResumeCompletedRequestSchema,
    AgentUpdateFunctionsRequestSchema,
    AgentDeleteRequestSchema,
    AgentActionByIdSchema,
} from '../schemas/agent.schema';
import { ApiNullResponseSchema } from '../schemas/common.schema';
import { Static, Type } from '@sinclair/typebox';

const AGENT_BASE_V1 = '/api/agent/v1';

export const AGENT_API = {
    list: defineRoute('GET', `${AGENT_BASE_V1}/list`, {
        schema: { response: { 200: Type.Array(AgentContextSchema) } }
    }),
    details: defineRoute('GET', `${AGENT_BASE_V1}/details/:agentId`, {
        schema: { path: AgentIdParamsSchema, response: { 200: AgentContextSchema } }
    }),
    start: defineRoute('POST', `${AGENT_BASE_V1}/start`, {
        schema: { body: AgentStartRequestSchema, response: { 201: AgentContextSchema } } // 201 for resource creation
    }),
    delete: defineRoute('POST', `${AGENT_BASE_V1}/delete`, {
        schema: { body: AgentDeleteRequestSchema, response: { 204: ApiNullResponseSchema } } // 204 for no content
    }),

    forceStop: defineRoute('POST', `${AGENT_BASE_V1}/force-stop`, { // Assuming executionId might not always be available or relevant for a hard stop
        schema: { body: AgentActionByIdSchema, response: { 200: ApiNullResponseSchema } } // Or 204
    }),
    feedback: defineRoute('POST', `${AGENT_BASE_V1}/feedback`, {
        schema: { body: AgentFeedbackRequestSchema, response: { 200: AgentContextSchema } }
    }),
    resumeError: defineRoute('POST', `${AGENT_BASE_V1}/resume-error`, {
        schema: { body: AgentFeedbackRequestSchema, response: { 200: AgentContextSchema } }
    }),
    resumeHil: defineRoute('POST', `${AGENT_BASE_V1}/resume-hil`, {
        schema: { body: AgentFeedbackRequestSchema, response: { 200: AgentContextSchema } }
    }),
    requestHil: defineRoute('POST', `${AGENT_BASE_V1}/request-hil`, {
        schema: { body: AgentActionBaseSchema, response: { 200: AgentContextSchema } }
    }),
    cancel: defineRoute('POST', `${AGENT_BASE_V1}/cancel`, {
        schema: { body: AgentCancelRequestSchema, response: { 200: AgentContextSchema } }
    }),
    resumeCompleted: defineRoute('POST', `${AGENT_BASE_V1}/resume-completed`, {
        schema: { body: AgentResumeCompletedRequestSchema, response: { 200: AgentContextSchema } }
    }),
    updateFunctions: defineRoute('POST', `${AGENT_BASE_V1}/update-functions`, {
        schema: { body: AgentUpdateFunctionsRequestSchema, response: { 200: AgentContextSchema } }
    }),

    getIterations: defineRoute('GET', `${AGENT_BASE_V1}/iterations/:agentId`, {
        schema: { path: AgentIdParamsSchema, response: { 200: Type.Array(AutonomousIterationSchema) } }
    }),
    // Inside AGENT_API object:
    getAvailableFunctions: defineRoute('GET', `${AGENT_BASE_V1}/functions`, {
        schema: { response: { 200: Type.Array(Type.String()) } } // Using Type.Array(Type.String()) directly for robustness
    }),
    listHumanInLoopAgents: defineRoute('GET', `${AGENT_BASE_V1}/list/humanInLoop`, {
        schema: { response: { 200: Type.Array(AgentContextSchema) } }
    }),
};
