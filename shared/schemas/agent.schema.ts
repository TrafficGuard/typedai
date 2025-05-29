import { type Static, Type } from '@sinclair/typebox';
import {
	AGENT_PREVIEW_KEYS,
	AUTONOMOUS_ITERATION_SUMMARY_KEYS,
	type AgentContext,
	type AgentContextPreview,
	type AutonomousIteration,
	type AutonomousIterationSummary,
} from '../model/agent.model';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';
import { GenerationStatsSchema, LlmMessagesSchema, type LlmMessagesSchemaModel } from './llm.schema';

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

const TaskLevelSchema = Type.Union([Type.Literal('easy'), Type.Literal('medium'), Type.Literal('hard'), Type.Literal('xhard')]);

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
	// Let's use `data` as the property name for content, to align with `ai` library's FilePart.
	data: Type.String(), // Content of the file
	mimeType: Type.String(),
	filename: Type.Optional(Type.String()),
	size: Type.Optional(Type.Number()),
	externalURL: Type.Optional(Type.String()),
});

const LlmMessageContentPartSchema = Type.Union([TextPartSchema, ImagePartExtSchema, FilePartExtSchema]); // Add other relevant parts like ToolCallPart if needed

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
	subtype: Type.String(),
	childAgents: Type.Optional(Type.Array(Type.String())),
	executionId: Type.String(),
	typedAiRepoDir: Type.String(),
	traceId: Type.String(),
	name: Type.String(),
	parentAgentId: Type.Optional(Type.String()),
	codeTaskId: Type.Optional(Type.String()),
	// The schema represents the serialized form, where user is just the ID string
	user: Type.String(), // Changed from UserSchema to Type.String()
	state: AgentRunningStateSchema,
	callStack: Type.Array(Type.String()),
	error: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	output: Type.Optional(Type.String()),
	hilBudget: Type.Number(),
	cost: Type.Number(),
	budgetRemaining: Type.Number(),
	llms: Type.Object({
		// Serialized LLM IDs
		easy: Type.String(),
		medium: Type.String(),
		hard: Type.String(),
		xhard: Type.Optional(Type.String()),
	}),

	// Represents IFileSystemService.toJSON()
	// The key 'fileSystem' is always present on AgentContext, its value can be an object or null.
	// Changed from Type.Optional(Type.Union(...)) to Type.Union(...)
	fileSystem: Type.Union([
		Type.Object({
			basePath: Type.String(),
			workingDirectory: Type.String(),
		}),
		Type.Null(),
	]),
	useSharedRepos: Type.Boolean(),
	memory: Type.Record(Type.String(), Type.String()),
	lastUpdate: Type.Number(),
	metadata: Type.Record(Type.String(), Type.Any()),
	// Represents LlmFunctions.toJSON()
	functions: Type.Object({
		functionClasses: Type.Array(Type.String()),
	}),

	// Serialized as handler ID
	completedHandler: Type.Optional(Type.String()), // Changed from completedHandlerId

	pendingMessages: Type.Array(Type.String()),

	iterations: Type.Number(),
	invoking: Type.Array(FunctionCallSchema),
	notes: Type.Array(Type.String()),
	userPrompt: Type.String(),
	inputPrompt: Type.String(),
	messages: LlmMessagesSchema,
	functionCallHistory: Type.Array(FunctionCallResultSchema),
	hilCount: Type.Number(), // Type was 'any' in model, assuming number
	hilRequested: Type.Optional(Type.Boolean()),
	liveFiles: Type.Optional(Type.Array(Type.String())),
	fileStore: Type.Optional(Type.Array(FileMetadataSchema)),
	toolState: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

// Define a type for AgentContext where fields that are transformed during serialization
// are represented by their serialized schema's static type.
type AgentContextBaseForCheck = Omit<
	AgentContext,
	| 'messages'
	| 'llms'
	| 'functions'
	| 'fileSystem'
	| 'completedHandler' // Omit the original field name for handler
	| 'user' // Omit the original user object
>;

type AgentContextWithSerializedParts = AgentContextBaseForCheck & {
	messages: LlmMessagesSchemaModel; // Static type from LlmMessagesSchema
	llms: Static<typeof AgentContextSchema.properties.llms>;
	functions: Static<typeof AgentContextSchema.properties.functions>;
	fileSystem: Static<typeof AgentContextSchema.properties.fileSystem>;
	completedHandler: Static<typeof AgentContextSchema.properties.completedHandler>; // Use 'completedHandler'
	user: Static<typeof AgentContextSchema.properties.user>; // Use the serialized user ID type
};

export type AgentContextApi = Static<typeof AgentContextSchema>;

// const _agentContextCheck: AreTypesFullyCompatible<AgentContextWithSerializedParts, AgentContextApi> = true;

export const AgentContextPreviewSchema = Type.Pick(AgentContextSchema, AGENT_PREVIEW_KEYS);

const _agentContextPreviewCheck: AreTypesFullyCompatible<AgentContextPreview, Static<typeof AgentContextPreviewSchema>> = true;

export const AutonomousIterationSchema = Type.Object({
	agentId: Type.String(),
	iteration: Type.Number(),
	cost: Type.Number(),
	summary: Type.String(),
	functions: Type.Array(Type.String()), // class names
	prompt: Type.String(),
	images: Type.Array(ImagePartExtSchema),
	expandedUserRequest: Type.String(),
	observationsReasoning: Type.Optional(Type.String()),
	agentPlan: Type.String(),
	nextStepDetails: Type.String(),
	draftCode: Type.String(),
	codeReview: Type.String(),
	code: Type.String(),
	executedCode: Type.String(),
	functionCalls: Type.Array(FunctionCallResultSchema),
	memory: Type.Record(Type.String(), Type.String()),
	toolState: Type.Record(Type.String(), Type.Any()),
	error: Type.Optional(Type.String()),
	stats: GenerationStatsSchema,
});

// This check depends on AutonomousIteration.memory and .toolState being Record, not Map.
const _autonomousIterationCheck: AreTypesFullyCompatible<AutonomousIteration, Static<typeof AutonomousIterationSchema>> = true;

export const AutonomousIterationSummarySchema = Type.Pick(AutonomousIterationSchema, AUTONOMOUS_ITERATION_SUMMARY_KEYS, { $id: 'AutonomousIterationSummary' });

const _AutonomousIterationSummaryCheck: AreTypesFullyCompatible<AutonomousIterationSummary, Static<typeof AutonomousIterationSummarySchema>> = true;

export const AgentIdParamsSchema = Type.Object({
	agentId: Type.String({ description: 'The ID of the agent' }),
});

// --- Placeholder Schemas (as per original request, to be defined properly if needed later) ---

export const AgentFeedbackRequestSchema = Type.Object({
	agentId: Type.Optional(Type.String()), // Example: making fields optional or specific
	executionId: Type.Optional(Type.String()),
	feedback: Type.Optional(Type.String()),
});

export const AgentStartRequestSchema = Type.Object(
	{
		agentName: Type.String(),
		initialPrompt: Type.String(),
		type: AgentTypeSchema,
		subtype: Type.Optional(Type.String()),
		functions: Type.Optional(Type.Array(Type.String())),
		humanInLoop: Type.Optional(
			Type.Object({
				budget: Type.Number(), // Ensure these are not optional if they are mandatory in current route
				count: Type.Integer(), // Ensure these are not optional if they are mandatory in current route
			}),
		),
		llms: Type.Object({
			// Expects LLM string IDs
			easy: Type.String(),
			medium: Type.String(),
			hard: Type.String(),
		}),
		useSharedRepos: Type.Optional(Type.Boolean({ default: true })), // Retain default from original schema
		metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
		resumeAgentId: Type.Optional(Type.String()),
		parentAgentId: Type.Optional(Type.String()),
		codeTaskId: Type.Optional(Type.String()),
	},
	{ $id: 'AgentStartRequest' },
);

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

export const AgentActionByIdSchema = Type.Object({
	// This seems identical to AgentIdParamsSchema
	agentId: Type.String({ description: 'The ID of the agent' }),
});
