import { type Static, Type } from '@sinclair/typebox';
import {
	type Citation,
	type Claim,
	type ClaimStatus,
	type CodeTrace,
	DEBATE_PREVIEW_KEYS,
	type DebateConfig,
	type DebateList,
	type DebatePhase,
	type DebatePosition,
	type DebatePreview,
	type DebateResult,
	type DebateRound,
	type DebateState,
	type DebaterConfig,
	type DebaterType,
	type HitlDecision,
	type StartDebateRequest,
	type SynthesizedAnswer,
	type ToolCallRecord,
	type VerifiedAnswer,
} from '#shared/debate/debate.model';
import type { AreTypesFullyCompatible } from '#shared/typeUtils';

// ============================================================================
// Basic Type Schemas
// ============================================================================

export const CitationTypeSchema = Type.Union([Type.Literal('file'), Type.Literal('url'), Type.Literal('document')]);

export const CitationSchema = Type.Object({
	type: CitationTypeSchema,
	source: Type.String(),
	excerpt: Type.String(),
	lineNumbers: Type.Optional(Type.Tuple([Type.Number(), Type.Number()])),
});
const _CitationCheck: AreTypesFullyCompatible<Citation, Static<typeof CitationSchema>> = true;

export const CodeTraceSchema = Type.Object({
	description: Type.String(),
	files: Type.Array(Type.String()),
	excerpt: Type.String(),
});
const _CodeTraceCheck: AreTypesFullyCompatible<CodeTrace, Static<typeof CodeTraceSchema>> = true;

export const ToolCallRecordSchema = Type.Object({
	toolName: Type.String(),
	parameters: Type.Record(Type.String(), Type.Unknown()),
	result: Type.Unknown(),
	agentId: Type.String(),
	executionTimeMs: Type.Number(),
	timestamp: Type.Optional(Type.Number()),
});
const _ToolCallRecordCheck: AreTypesFullyCompatible<ToolCallRecord, Static<typeof ToolCallRecordSchema>> = true;

// ============================================================================
// Debater Schemas
// ============================================================================

export const DebaterTypeSchema = Type.Union([Type.Literal('llm'), Type.Literal('claude-agent-sdk')]);
const _DebaterTypeCheck: AreTypesFullyCompatible<DebaterType, Static<typeof DebaterTypeSchema>> = true;

export const DebaterConfigSchema = Type.Object({
	id: Type.String(),
	name: Type.String(),
	type: DebaterTypeSchema,
	model: Type.Optional(Type.String()),
	persona: Type.Optional(Type.String()),
});
const _DebaterConfigCheck: AreTypesFullyCompatible<DebaterConfig, Static<typeof DebaterConfigSchema>> = true;

// ============================================================================
// Position Schemas
// ============================================================================

export const DebatePositionSchema = Type.Object({
	agentId: Type.String(),
	position: Type.String(),
	confidence: Type.Number(),
	reasoning: Type.String(),
	citations: Type.Array(CitationSchema),
	codeTraces: Type.Array(CodeTraceSchema),
	toolCalls: Type.Array(ToolCallRecordSchema),
});
const _DebatePositionCheck: AreTypesFullyCompatible<DebatePosition, Static<typeof DebatePositionSchema>> = true;

// ============================================================================
// Round Schemas
// ============================================================================

export const DebateRoundSchema = Type.Object({
	round: Type.Number(),
	positions: Type.Array(DebatePositionSchema),
	toolCalls: Type.Array(ToolCallRecordSchema),
	consensusReached: Type.Boolean(),
	timestamp: Type.Number(),
});
const _DebateRoundCheck: AreTypesFullyCompatible<DebateRound, Static<typeof DebateRoundSchema>> = true;

// ============================================================================
// Verification Schemas
// ============================================================================

export const ClaimStatusSchema = Type.Union([Type.Literal('verified'), Type.Literal('unverified'), Type.Literal('incorrect')]);
const _ClaimStatusCheck: AreTypesFullyCompatible<ClaimStatus, Static<typeof ClaimStatusSchema>> = true;

export const ClaimSchema = Type.Object({
	claim: Type.String(),
	status: ClaimStatusSchema,
	citation: Type.Optional(CitationSchema),
	correction: Type.Optional(Type.String()),
});
const _ClaimCheck: AreTypesFullyCompatible<Claim, Static<typeof ClaimSchema>> = true;

export const SynthesizedAnswerSchema = Type.Object({
	answer: Type.String(),
	keyPoints: Type.Array(
		Type.Object({
			agentId: Type.String(),
			points: Type.Array(Type.String()),
		}),
	),
	citations: Type.Array(CitationSchema),
	confidence: Type.Number(),
});
const _SynthesizedAnswerCheck: AreTypesFullyCompatible<SynthesizedAnswer, Static<typeof SynthesizedAnswerSchema>> = true;

export const VerifiedAnswerSchema = Type.Object({
	originalAnswer: Type.String(),
	verifiedAnswer: Type.String(),
	claims: Type.Array(ClaimSchema),
	corrections: Type.Array(Type.String()),
	citations: Type.Array(CitationSchema),
});
const _VerifiedAnswerCheck: AreTypesFullyCompatible<VerifiedAnswer, Static<typeof VerifiedAnswerSchema>> = true;

// ============================================================================
// Debate State Schemas
// ============================================================================

export const DebatePhaseSchema = Type.Union([
	Type.Literal('initial'),
	Type.Literal('debate'),
	Type.Literal('consensus'),
	Type.Literal('hitl'),
	Type.Literal('paused'),
	Type.Literal('synthesis'),
	Type.Literal('verification'),
	Type.Literal('complete'),
	Type.Literal('error'),
]);
const _DebatePhaseCheck: AreTypesFullyCompatible<DebatePhase, Static<typeof DebatePhaseSchema>> = true;

export const DebateConfigSchema = Type.Object({
	maxRounds: Type.Number(),
	hitlEnabled: Type.Boolean(),
	debug: Type.Optional(Type.Boolean()),
});
const _DebateConfigCheck: AreTypesFullyCompatible<DebateConfig, Static<typeof DebateConfigSchema>> = true;

export const HitlDecisionSchema = Type.Object({
	selectedAgentId: Type.Optional(Type.String()),
	customAnswer: Type.Optional(Type.String()),
	feedback: Type.Optional(Type.String()),
});
const _HitlDecisionCheck: AreTypesFullyCompatible<HitlDecision, Static<typeof HitlDecisionSchema>> = true;

export const DebateStateSchema = Type.Object(
	{
		debateId: Type.String(),
		userId: Type.Optional(Type.String()),
		topic: Type.String(),
		backgroundContext: Type.Optional(Type.String()),
		phase: DebatePhaseSchema,
		previousPhase: Type.Optional(DebatePhaseSchema),
		currentRound: Type.Number(),
		rounds: Type.Array(DebateRoundSchema),
		debaters: Type.Array(DebaterConfigSchema),
		config: DebateConfigSchema,
		hitlDecision: Type.Optional(HitlDecisionSchema),
		startTime: Type.Number(),
		endTime: Type.Optional(Type.Number()),
		error: Type.Optional(Type.String()),
	},
	{ $id: 'DebateState' },
);
const _DebateStateCheck: AreTypesFullyCompatible<DebateState, Static<typeof DebateStateSchema>> = true;

export const DebateResultSchema = Type.Object(
	{
		debateId: Type.String(),
		topic: Type.String(),
		synthesizedAnswer: SynthesizedAnswerSchema,
		verifiedAnswer: VerifiedAnswerSchema,
		rounds: Type.Array(DebateRoundSchema),
		roundCount: Type.Number(),
		consensusReached: Type.Boolean(),
		hitlInvoked: Type.Boolean(),
		executionTimeMs: Type.Number(),
		totalCost: Type.Optional(Type.Number()),
	},
	{ $id: 'DebateResult' },
);
const _DebateResultCheck: AreTypesFullyCompatible<DebateResult, Static<typeof DebateResultSchema>> = true;

// ============================================================================
// API Request/Response Schemas
// ============================================================================

export const DebateParamsSchema = Type.Object(
	{
		debateId: Type.String(),
	},
	{ $id: 'DebateParams' },
);
export type DebateParams = Static<typeof DebateParamsSchema>;

export const StartDebateRequestSchema = Type.Object(
	{
		topic: Type.String(),
		backgroundContext: Type.Optional(Type.String()),
		debaters: Type.Array(DebaterConfigSchema),
		maxRounds: Type.Optional(Type.Number()),
		hitlEnabled: Type.Optional(Type.Boolean()),
	},
	{ $id: 'StartDebateRequest' },
);
const _StartDebateRequestCheck: AreTypesFullyCompatible<StartDebateRequest, Static<typeof StartDebateRequestSchema>> = true;

// ============================================================================
// List Schemas
// ============================================================================

export const DebatePreviewSchema = Type.Pick(DebateStateSchema, DEBATE_PREVIEW_KEYS, { $id: 'DebatePreview' });
const _DebatePreviewCheck: AreTypesFullyCompatible<DebatePreview, Static<typeof DebatePreviewSchema>> = true;

export const DebateListSchema = Type.Object(
	{
		debates: Type.Array(DebateStateSchema),
		hasMore: Type.Boolean(),
	},
	{ $id: 'DebateList' },
);
const _DebateListCheck: AreTypesFullyCompatible<DebateList, Static<typeof DebateListSchema>> = true;

export const DebateListQuerySchema = Type.Object(
	{
		startAfterId: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
	},
	{ $id: 'DebateListQuery' },
);

// ============================================================================
// Static Type Exports
// ============================================================================

export type DebateStateSchemaModel = Static<typeof DebateStateSchema>;
export type DebateResultSchemaModel = Static<typeof DebateResultSchema>;
export type DebateListSchemaModel = Static<typeof DebateListSchema>;
export type StartDebateRequestSchemaModel = Static<typeof StartDebateRequestSchema>;
export type HitlDecisionSchemaModel = Static<typeof HitlDecisionSchema>;
