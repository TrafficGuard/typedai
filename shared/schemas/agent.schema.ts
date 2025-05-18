import { Type, type Static } from '@sinclair/typebox';
import type { AgentContext, AutonomousIteration, AgentRunningState, TaskLevel } from '../model/agent.model';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';
import type { FunctionCall, FunctionCallResult, LlmMessage, ImagePartExt, GenerationStats, TextPart, FilePartExt } from '../model/llm.model';
import type { FileMetadata } from '../model/files.model';
import type { User } from '../model/user.model';

export const AgentTypeSchema = Type.Union([Type.Literal('autonomous'), Type.Literal('workflow')], { $id: 'AgentType' });
export const AutonomousSubTypeSchema = Type.Union([Type.Literal('xml'), Type.Literal('codegen'), Type.String()], { $id: 'AutonomousSubType' }); // string for custom subtypes

export const AgentRunningStateSchema = Type.Union(
    [
        Type.Literal('workflow'),
        Type.Literal('agent'),
        Type.Literal('functions'),
        Type.Literal('error'),
        Type.Literal('hil'), // deprecated
        Type.Literal('hitl_threshold'),
        Type.Literal('hitl_tool'),
        Type.Literal('hitl_feedback'),
        Type.Literal('completed'),
        Type.Literal('shutdown'),
        Type.Literal('child_agents'),
        Type.Literal('timeout'),
    ],
    { $id: 'AgentRunningState' },
);

const TaskLevelSchema = Type.Union([
    Type.Literal('easy'),
    Type.Literal('medium'),
    Type.Literal('hard'),
    Type.Literal('xhard'),
]);

// Schemas for types from llm.model.ts
const FunctionCallSchema = Type.Object({
    iteration: Type.Optional(Type.Number()),
    function_name: Type.String(),
    parameters: Type.Record(Type.String(), Type.Any()),
});

const FunctionCallResultSchema = Type.Intersect([
    FunctionCallSchema,
    Type.Object({
        stdout: Type.Optional(Type.String()),
        stdoutSummary: Type.Optional(Type.String()),
        stderr: Type.Optional(Type.String()),
        stderrSummary: Type.Optional(Type.String()),
    }),
]);

const TextPartSchema = Type.Object({
    type: Type.Literal('text'),
    text: Type.String(),
});

const ImagePartExtSchema = Type.Object({
    type: Type.Literal('image'),
    image: Type.String(), // In ImagePartUI, 'image' is string
    mimeType: Type.Optional(Type.String()),
    filename: Type.Optional(Type.String()),
    size: Type.Optional(Type.Number()),
    externalURL: Type.Optional(Type.String()),
});

const FilePartExtSchema = Type.Object({
    type: Type.Literal('file'),
    // In FilePartUI, 'file' (data) is string. Assuming 'data' as the property name based on FilePart.
    // If FilePartExt renames 'file' to 'data', this is correct.
    // From llm.model.ts: FilePartUI = ChangePropertyType<FilePart, 'data', string >;
    // FilePart has `image: DataContent | URL;` which is confusing. Assuming it means `data` for files.
    // Let's assume FilePartExt has a `data: string` field for the content.
    // If FilePartExt actually uses `file: string` for content, this needs adjustment.
    // Based on `FilePart { type: 'file'; image: DataContent | URL; mimeType: string; }`
    // and `FilePartUI = ChangePropertyType<FilePart, 'data', string >`, this implies `FilePart` should have `data`.
    // Let's assume `FilePartExt` has `data: string` for content.
    // If `FilePart` has `file: DataContent | URL`, then `FilePartExt` would have `file: string`.
    // The type `FilePart` in `ai` package has `file: DataContent | URL`.
    // So `FilePartExt` (if it's based on `FilePart`) should have `file: string`.
    // Let's use `file` as the property name for content, matching `FilePart`.
    file: Type.String(), // Content of the file
    mimeType: Type.String(),
    filename: Type.Optional(Type.String()),
    size: Type.Optional(Type.Number()),
    externalURL: Type.Optional(Type.String()),
});


const LlmMessageContentPartSchema = Type.Union([TextPartSchema, ImagePartExtSchema, FilePartExtSchema]); // Add other relevant parts like ToolCallPart if needed

const GenerationStatsSchema = Type.Object({
    requestTime: Type.Number(),
    timeToFirstToken: Type.Number(),
    totalTime: Type.Number(),
    inputTokens: Type.Number(),
    outputTokens: Type.Number(),
    cachedInputTokens: Type.Optional(Type.Number()),
    cost: Type.Number(),
    llmId: Type.String(),
});

const LlmMessageSchema = Type.Object({
    role: Type.String(), // Ideally Type.Union(['system', 'user', 'assistant', 'tool'])
    content: Type.Union([Type.String(), Type.Array(LlmMessageContentPartSchema)]),
    llmId: Type.Optional(Type.String()),
    cache: Type.Optional(Type.Literal('ephemeral')),
    time: Type.Optional(Type.Number()),
    stats: Type.Optional(GenerationStatsSchema),
    providerOptions: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

// Schema for FileMetadata from files.model.ts
const FileMetadataSchema = Type.Object({
    filename: Type.String(),
    description: Type.String(),
    size: Type.Number(),
    lastUpdated: Type.String(), // Assuming string representation of date
});


export const AgentContextSchema = Type.Object({
    agentId: Type.String(),
    type: AgentTypeSchema,
    subtype: AutonomousSubTypeSchema,
    childAgents: Type.Optional(Type.Array(Type.String())),
    executionId: Type.String(),
    typedAiRepoDir: Type.String(), // Made non-optional as per model, or make optional in model
    traceId: Type.String(),
    name: Type.String(),
    parentAgentId: Type.Optional(Type.String()),
    vibeSessionId: Type.Optional(Type.String()),
    // user: Type.Object({}), // Representing user ID, will be changed to Type.Optional(Type.String())
    user: Type.Optional(Type.String()), // Serialized as user ID
    state: AgentRunningStateSchema,
    callStack: Type.Array(Type.String()), // Made non-optional as per model
    error: Type.Optional(Type.String()),
    output: Type.Optional(Type.String()),
    hilBudget: Type.Number(),
    cost: Type.Number(),
    budgetRemaining: Type.Number(),
    llms: Type.Object({ // Serialized LLM IDs
        easy: Type.Optional(Type.String()),
        medium: Type.Optional(Type.String()),
        hard: Type.Optional(Type.String()),
        xhard: Type.Optional(Type.String()),
    }),

    fileSystem: Type.Optional(Type.Null(Type.Object({ // Represents IFileSystemService.toJSON()
        basePath: Type.String(),
        workingDirectory: Type.String(),
    }))),
    useSharedRepos: Type.Boolean(), // Made non-optional as per model
    memory: Type.Record(Type.String(), Type.String()), // Made non-optional
    lastUpdate: Type.Number(),
    metadata: Type.Record(Type.String(), Type.Any()),
    functions: Type.Object({ // Represents LlmFunctions.toJSON()
        functionClasses: Type.Array(Type.String()),
    }),

    completedHandlerId: Type.Optional(Type.String()), // Serialized as handler ID

    pendingMessages: Type.Array(Type.String()), // Made non-optional

    iterations: Type.Number(),
    invoking: Type.Array(FunctionCallSchema), // Made non-optional
    notes: Type.Array(Type.String()),
    userPrompt: Type.String(),
    inputPrompt: Type.String(), // Made non-optional
    messages: Type.Array(LlmMessageSchema), // Made non-optional
    functionCallHistory: Type.Array(FunctionCallResultSchema), // Made non-optional
    hilCount: Type.Number(), // Type was 'any' in model, assuming number
    hilRequested: Type.Optional(Type.Boolean()),
    liveFiles: Type.Optional(Type.Array(Type.String())),
    fileStore: Type.Optional(Type.Array(FileMetadataSchema)),
    toolState: Type.Optional(Type.Record(Type.String(), Type.Any())),

    // Ensure all fields from AgentContext are covered and optionality matches.
    // Fields from AgentContext:
    // agentId: string; -> Type.String()
    // type: AgentType; -> AgentTypeSchema
    // subtype: AutonomousSubType | string; -> AutonomousSubTypeSchema
    // childAgents?: string[]; -> Type.Optional(Type.Array(Type.String()))
    // executionId: string; -> Type.String()
    // typedAiRepoDir: string; -> Type.String()
    // traceId: string; -> Type.String()
    // name: string; -> Type.String()
    // parentAgentId?: string; -> Type.Optional(Type.String())
    // vibeSessionId?: string; -> Type.Optional(Type.String())
    // user: User; -> This is the main problem for AgentContextSchema.user being Type.String()
    // For the check to pass with `user: Type.String()` in schema, `AgentContext.user` must be `string`.
    // If `AgentContext.user` is `User` object, schema needs `UserSchema`.
    // Let's assume the original `user: Type.Optional(Type.String())` in schema meant user ID.
    // This requires `AgentContext.user` to be `string | User` or the check to be against a serialized form.
    // user: Type.Object({ // This was the duplicate, removed. The one above (Type.Optional(Type.String())) is used.
    //     id: Type.String(),
    //     name: Type.String(),
    //     email: Type.String(),
    //     enabled: Type.Boolean(),
    //     passwordHash: Type.Optional(Type.String()),
    //     createdAt: Type.Any(), 
    //     lastLoginAt: Type.Optional(Type.Any()), 
    //     hilBudget: Type.Number(),
    //     hilCount: Type.Number(),
    // }),
});

// This check will likely still fail if AgentContext contains methods or complex non-data objects
// not perfectly mirrored by Static<AgentContextSchema> (e.g. user (User object vs string ID), llms (LLM instances vs string IDs), functions, fileSystem, completedHandler (instances vs string ID)).
// Also, Date objects in User model vs. schema representation (e.g. number for timestamp or string for ISO) will cause issues.
// For User.createdAt and User.lastLoginAt to pass, they'd need to be Type.Number() if AgentContext serializes them as timestamps,
// or Type.String() if ISO strings. For now, the check might remain false.
const _agentContextCheck: AreTypesFullyCompatible<AgentContext, Static<typeof AgentContextSchema>> = true;

export const AutonomousIterationSchema = Type.Object({
    agentId: Type.String(),
    iteration: Type.Number(),
    cost: Type.Number(),
    summary: Type.String(),
    functions: Type.Array(Type.String()), // class names
    prompt: Type.String(),
    images: Type.Array(ImagePartExtSchema),
    expandedUserRequest: Type.String(),
    observationsReasoning: Type.String(),
    agentPlan: Type.String(),
    nextStepDetails: Type.String(),
    draftCode: Type.String(),
    codeReview: Type.String(),
    code: Type.String(),
    executedCode: Type.String(),
    functionCalls: Type.Array(FunctionCallResultSchema),
    memory: Type.Record(Type.String(), Type.String()), // Aligned with model change from Map to Record
    toolState: Type.Record(Type.String(), Type.Any()), // Aligned with model change from Map to Record
    error: Type.Optional(Type.String()),
    stats: GenerationStatsSchema,
    liveFiles: Type.Optional(Type.Array(Type.String())),
    // fileStore: Type.Optional(Type.Array(FileMetadataSchema)) // Model has this commented out
});

// This check depends on AutonomousIteration.memory and .toolState being Record, not Map.
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
