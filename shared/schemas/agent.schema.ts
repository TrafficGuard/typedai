import { Type, type Static } from '@sinclair/typebox';
import type { AgentContext, AutonomousIteration } from '../model/agent.model';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';

export const AgentTypeSchema = Type.Union([Type.Literal('autonomous'), Type.Literal('workflow')], { $id: 'AgentType' });
export const AutonomousSubTypeSchema = Type.Union([Type.Literal('xml'), Type.Literal('codegen'), Type.String()], { $id: 'AutonomousSubType' });

export const AgentContextSchema = Type.Object({
    agentId: Type.String(),
    type: Type.String(), // Represents AgentType
    subtype: Type.String(), // Represents AutonomousSubType | string
    childAgents: Type.Optional(Type.Array(Type.String())),
    executionId: Type.String(),
    traceId: Type.String(), // Added traceId
    name: Type.String(),
    parentAgentId: Type.Optional(Type.String()),
    vibeSessionId: Type.Optional(Type.String()),
    state: Type.String(), // Represents AgentRunningState
    error: Type.Optional(Type.String()),
    output: Type.Optional(Type.String()),
    hilBudget: Type.Number(),
    cost: Type.Number(),
    budgetRemaining: Type.Number(),
    llms: Type.Object({ // Represents serialized AgentLLMs
        easy: Type.Optional(Type.String()),
        medium: Type.Optional(Type.String()),
        hard: Type.Optional(Type.String()),
        xhard: Type.Optional(Type.String()),
    }),
    lastUpdate: Type.Number(),
    metadata: Type.Record(Type.String(), Type.Any()), // Represents Record<string, any>
    functions: Type.Object({ // Represents serialized LlmFunctions (toJSON() output)
        functionClasses: Type.Array(Type.String()),
    }),
    iterations: Type.Number(),
    notes: Type.Array(Type.String()),
    userPrompt: Type.String(),
    hilCount: Type.Number(),
    hilRequested: Type.Optional(Type.Boolean()),
    liveFiles: Type.Optional(Type.Array(Type.String())),

    // Fields required by deserializeAgentContext
    typedAiRepoDir: Type.Optional(Type.String()),
    callStack: Type.Optional(Type.Array(Type.String())),
    fileSystem: Type.Optional(Type.Object({ basePath: Type.Any(), workingDirectory: Type.Any() }, { additionalProperties: true })), // Allow other props if any
    useSharedRepos: Type.Optional(Type.Boolean()),
    memory: Type.Optional(Type.Record(Type.String(), Type.String())),
    completedHandlerId: Type.Optional(Type.String()), // ID of the completion handler
    pendingMessages: Type.Optional(Type.Array(Type.String())),
    invoking: Type.Optional(Type.Array(Type.Any())), // Represents FunctionCall[]
    inputPrompt: Type.Optional(Type.String()),
    messages: Type.Optional(Type.Array(Type.Any())), // Represents LlmMessage[]
    functionCallHistory: Type.Optional(Type.Any()), // Represents FunctionCallResult[], can be string or array
    fileStore: Type.Optional(Type.Array(Type.Any())), // Represents FileMetadata[]
    toolState: Type.Optional(Type.Any()), // Represents Record<string, any>, often serialized as JSON string then parsed
    user: Type.Optional(Type.String()), // User ID
});

const _agentContextCheck: AreTypesFullyCompatible<AgentContext, Static<typeof AgentContextSchema>> = true;

export const AutonomousIterationSchema = Type.Object({
    agentId: Type.String(),
    iteration: Type.Number(),
    cost: Type.Number(),
    summary: Type.String(),
    functions: Type.Array(Type.String()),
    prompt: Type.String(),
    images: Type.Array(Type.Any()), // Represents ImagePartExt[] - using Type.Any() for simplicity
    expandedUserRequest: Type.String(),
    observationsReasoning: Type.String(),
    agentPlan: Type.String(),
    nextStepDetails: Type.String(),
    draftCode: Type.String(),
    codeReview: Type.String(),
    code: Type.String(),
    executedCode: Type.String(),
    functionCalls: Type.Array(Type.Any()), // Represents FunctionCallResult[] - using Type.Any() for simplicity
    memory: Type.Record(Type.String(), Type.String()), // Represents Map<string, string>
    toolState: Type.Record(Type.String(), Type.Any()), // Represents Map<string, any>
    error: Type.Optional(Type.String()),
    stats: Type.Any(), // Represents GenerationStats - using Type.Any() for simplicity
    liveFiles: Type.Optional(Type.Array(Type.String())),
});

const _autonomousIterationCheck: AreTypesFullyCompatible<AutonomousIteration, Static<typeof AutonomousIterationSchema>> = true;

export const AgentIdParamsSchema = Type.Object({
    agentId: Type.String({ description: 'The ID of the agent' }),
});

// --- Placeholder Schemas (as per original request, to be defined properly if needed later) ---

export const AgentFeedbackRequestSchema = Type.Object({
    agentId: Type.Optional(Type.String()), // Example: making fields optional or specific
    executionId: Type.Optional(Type.String()),
    feedback: Type.Optional(Type.String()),
});

export const AgentStartRequestSchema = Type.Object({
    agentName: Type.String(),
    initialPrompt: Type.String(),
    type: AgentTypeSchema, // Use the defined AgentTypeSchema
    subtype: Type.Optional(AutonomousSubTypeSchema), // Use the defined AutonomousSubTypeSchema
    functions: Type.Optional(Type.Array(Type.String())),
    humanInLoop: Type.Optional(Type.Object({
        budget: Type.Number(), // Ensure these are not optional if they are mandatory in current route
        count: Type.Integer(), // Ensure these are not optional if they are mandatory in current route
    })),
    llms: Type.Object({ // Expects LLM string IDs
        easy: Type.String(),
        medium: Type.String(),
        hard: Type.String(),
    }),
    useSharedRepos: Type.Optional(Type.Boolean({ default: true })), // Retain default from original schema
    metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
    resumeAgentId: Type.Optional(Type.String()),
    parentAgentId: Type.Optional(Type.String()),
    vibeSessionId: Type.Optional(Type.String()),
}, { $id: 'AgentStartRequest' });

export const AgentActionBaseSchema = Type.Object({
    agentId: Type.Optional(Type.String()),
    executionId: Type.Optional(Type.String()),
});

export const AgentCancelRequestSchema = Type.Object({
    agentId: Type.Optional(Type.String()),
    executionId: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String()),
});

export const AgentResumeCompletedRequestSchema = Type.Object({
    agentId: Type.Optional(Type.String()),
    executionId: Type.Optional(Type.String()),
    instructions: Type.Optional(Type.String()),
});

export const AgentUpdateFunctionsRequestSchema = Type.Object({
    agentId: Type.Optional(Type.String()),
    functions: Type.Optional(Type.Array(Type.String())),
});

export const AgentDeleteRequestSchema = Type.Object({
    agentIds: Type.Optional(Type.Array(Type.String())),
});

export const AgentActionByIdSchema = Type.Object({ // This seems identical to AgentIdParamsSchema
    agentId: Type.String({ description: 'The ID of the agent' }),
});
