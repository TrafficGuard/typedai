import { type Static, Type } from '@sinclair/typebox';
import type { LlmCall, LlmCallSummary, LlmRequest } from '../model/llmCall.model';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';
import { CallSettingsSchema, LlmCallMessageSummaryPartSchema, LlmMessagesSchema } from './llm.schema';

// Schema for LlmRequest, which LlmCall extends
// Not exported as it's a base for LlmCallSchema
const LlmRequestSchema = Type.Object({
	id: Type.String(),
	description: Type.Optional(Type.String()),
	messages: LlmMessagesSchema,
	settings: CallSettingsSchema,
	agentId: Type.Optional(Type.String()),
	userId: Type.Optional(Type.String()),
	callStack: Type.Optional(Type.String()),
	llmId: Type.String(),
	requestTime: Type.Number(),
	llmCallId: Type.Optional(Type.String()), // Internal ID
});

// Type check for LlmRequest (optional, but good for completeness)
// const _LlmRequestCheck: AreTypesFullyCompatible<LlmRequest, Static<typeof LlmRequestSchema>> = true;

export const LlmCallSchema = Type.Intersect(
	[
		LlmRequestSchema,
		Type.Object({
			timeToFirstToken: Type.Optional(Type.Number()),
			totalTime: Type.Optional(Type.Number()),
			cost: Type.Optional(Type.Number()),
			inputTokens: Type.Optional(Type.Number()),
			outputTokens: Type.Optional(Type.Number()),
			warning: Type.Optional(Type.String()),
			error: Type.Optional(Type.String()),
			chunkCount: Type.Optional(Type.Number()), // Internal ID
		}),
	],
	{ $id: 'LlmCall' },
);
const _LlmCallCheck: AreTypesFullyCompatible<LlmCall, Static<typeof LlmCallSchema>> = true;

export const LlmCallSummarySchema = Type.Object(
	{
		id: Type.String(),
		description: Type.Optional(Type.String()),
		llmId: Type.String(),
		requestTime: Type.Number(),
		totalTime: Type.Optional(Type.Number()),
		inputTokens: Type.Optional(Type.Number()),
		outputTokens: Type.Optional(Type.Number()),
		cost: Type.Optional(Type.Number()),
		error: Type.Optional(Type.Boolean()),
		callStack: Type.Optional(Type.String()),
		messageSummaries: Type.Array(LlmCallMessageSummaryPartSchema),
	},
	{ $id: 'LlmCallSummary' },
);
const _LlmCallSummaryCheck: AreTypesFullyCompatible<LlmCallSummary, Static<typeof LlmCallSummarySchema>> = true;
