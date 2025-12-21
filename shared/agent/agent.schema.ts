import { type Static, Type } from '@sinclair/typebox';
import type { AreTypesFullyCompatible } from '#shared/typeUtils';
import { GenerationStatsSchema, LlmMessagesSchema, type LlmMessagesSchemaModel } from '../llm/llm.schema';
import {
	AGENT_PREVIEW_KEYS,
	AUTONOMOUS_ITERATION_SUMMARY_KEYS,
	type AgentContext,
	type AgentContextPreview,
	type AutonomousIteration,
	type AutonomousIterationSummary,
} from './agent.model';

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
		Type.Literal('hitl_user'),
		Type.Literal('hitl_review'),
		Type.Literal('completed'),
		Type.Literal('restart'),
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

const ImagePartExtSchema = Type.Object({
	type: Type.Literal('image'),
	image: Type.String(), // In ImagePartUI, 'image' is string
	mediaType: Type.Optional(Type.String()),
	filename: Type.Optional(Type.String()),
	size: Type.Optional(Type.Number()),
	externalURL: Type.Optional(Type.String()),
});

const LlmsSchema = Type.Object({
	// Serialized LLM IDs
	easy: Type.String(),
	medium: Type.String(),
	hard: Type.String(),
	xhard: Type.Optional(Type.String()),
});

// Schema for FileMetadata from files.model.ts
const FileMetadataSchema = Type.Object({
	filename: Type.String(),
	description: Type.String(),
	size: Type.Number(),
	lastUpdated: Type.String(), // Assuming string representation of date
});

/**
 * Schema of the serialized AgentContext
 */
export const AgentContextSchema = Type.Object({
	agentId: Type.String(),
	type: AgentTypeSchema,
	subtype: Type.String(),
	childAgents: Type.Optional(Type.Array(Type.String())),
	executionId: Type.String(),
	containerId: Type.Optional(Type.String()),
	typedAiRepoDir: Type.String(),
	traceId: Type.String(),
	name: Type.String(),
	parentAgentId: Type.Optional(Type.String()),
	codeTaskId: Type.Optional(Type.String()),
	// The schema represents the serialized form, where user is just the ID string
	user: Type.String(),
	state: AgentRunningStateSchema,
	callStack: Type.Array(Type.String()),
	error: Type.Optional(Type.String()),
	output: Type.Optional(Type.String()),
	hilBudget: Type.Number(),
	cost: Type.Number(),
	budgetRemaining: Type.Number(),
	llms: LlmsSchema,

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
	createdAt: Type.Number(),
	metadata: Type.Record(Type.String(), Type.Any()),
	// Represents LlmFunctions.toJSON()
	functions: Type.Object({
		functionClasses: Type.Array(Type.String()),
	}),

	// Serialized as handler ID
	completedHandler: Type.Optional(Type.String()),

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
	toolState: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

export type AgentContextApi = Static<typeof AgentContextSchema>;

export const AgentContextPreviewSchema = Type.Pick(AgentContextSchema, AGENT_PREVIEW_KEYS, { $id: 'AgentContextPreview' });
const _agentContextPreviewCheck: AreTypesFullyCompatible<AgentContextPreview, Static<typeof AgentContextPreviewSchema>> = true;

const ProgressSignalSchema = Type.Union([Type.Literal('forward'), Type.Literal('lateral'), Type.Literal('backward'), Type.Literal('stuck')]);

const DecisionTypeSchema = Type.Union([
	Type.Literal('explore'),
	Type.Literal('implement'),
	Type.Literal('verify'),
	Type.Literal('fix'),
	Type.Literal('refactor'),
	Type.Literal('other'),
]);

export const AutonomousIterationSchema = Type.Object({
	agentId: Type.String(),
	iteration: Type.Number(),
	createdAt: Type.Optional(Type.Number()),
	cost: Type.Number(),
	summary: Type.String(),
	functions: Type.Array(Type.String()), // class names
	prompt: Type.String(),
	response: Type.String(),
	images: Type.Array(ImagePartExtSchema),
	expandedUserRequest: Type.String(),
	observationsReasoning: Type.Optional(Type.String()),
	agentPlan: Type.String(),
	nextStepDetails: Type.String(),
	draftCode: Type.Optional(Type.String()),
	codeReview: Type.Optional(Type.String()),
	code: Type.String(),
	executedCode: Type.String(),
	functionCalls: Type.Array(FunctionCallResultSchema),
	memory: Type.Record(Type.String(), Type.String()),
	toolState: Type.Optional(Type.Record(Type.String(), Type.Any())),
	error: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	stats: GenerationStatsSchema,
	// Evaluation metrics
	progressSignal: Type.Optional(ProgressSignalSchema),
	progressConfidence: Type.Optional(Type.Number()),
	filesRead: Type.Optional(Type.Number()),
	filesModified: Type.Optional(Type.Number()),
	linesAdded: Type.Optional(Type.Number()),
	linesRemoved: Type.Optional(Type.Number()),
	compileSuccess: Type.Optional(Type.Boolean()),
	testsRun: Type.Optional(Type.Number()),
	testsPassed: Type.Optional(Type.Number()),
	testsFailed: Type.Optional(Type.Number()),
	lintErrorsDelta: Type.Optional(Type.Number()),
	similarityToPrevious: Type.Optional(Type.Number()),
	repeatedPatternCount: Type.Optional(Type.Number()),
	decisionType: Type.Optional(DecisionTypeSchema),
	llmCallCount: Type.Optional(Type.Number()),
	llmTotalCost: Type.Optional(Type.Number()),
	llmTotalInputTokens: Type.Optional(Type.Number()),
	llmTotalOutputTokens: Type.Optional(Type.Number()),
	llmCacheHitRatio: Type.Optional(Type.Number()),
});

// This check depends on AutonomousIteration.memory and .toolState being Record, not Map.
type _autonomousIterationCheck = AreTypesFullyCompatible<AutonomousIteration, Static<typeof AutonomousIterationSchema>>;

export const AutonomousIterationSummarySchema = Type.Pick(AutonomousIterationSchema, AUTONOMOUS_ITERATION_SUMMARY_KEYS, {
	$id: 'AutonomousIterationSummary',
});

const _AutonomousIterationSummaryCheck: AreTypesFullyCompatible<AutonomousIterationSummary, Static<typeof AutonomousIterationSummarySchema>> = true;

export const AgentIdParamsSchema = Type.Object(
	{
		agentId: Type.String({ description: 'The ID of the agent' }),
	},
	{ $id: 'AgentIdParams' },
);

// --- Placeholder Schemas (as per original request, to be defined properly if needed later) ---

export const AgentFeedbackRequestSchema = Type.Object({
	agentId: Type.Optional(Type.String()),
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
		llms: LlmsSchema,
		useSharedRepos: Type.Optional(Type.Boolean({ default: true })), // Retain default from original schema
		metadata: Type.Optional(Type.Record(Type.String(), Type.Any())),
		resumeAgentId: Type.Optional(Type.String()),
		parentAgentId: Type.Optional(Type.String()),
		codeTaskId: Type.Optional(Type.String()),
	},
	{ $id: 'AgentStartRequest' },
);

export const AgentActionBaseSchema = Type.Object({
	agentId: Type.String(),
	executionId: Type.Optional(Type.String()),
});

export const AgentCancelRequestSchema = Type.Object({
	agentId: Type.String(),
	executionId: Type.Optional(Type.String()),
	reason: Type.Optional(Type.String()),
});

export const AgentResumeCompletedRequestSchema = Type.Object({
	agentId: Type.String(),
	executionId: Type.String(),
	instructions: Type.String(),
});

export const AgentUpdateFunctionsRequestSchema = Type.Object({
	agentId: Type.String(),
	functions: Type.Array(Type.String()),
});

export const AgentDeleteRequestSchema = Type.Object({
	agentIds: Type.Array(Type.String()),
});

export const AgentActionByIdSchema = Type.Object({
	// This seems identical to AgentIdParamsSchema
	agentId: Type.String({ description: 'The ID of the agent' }),
});
