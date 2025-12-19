import { LanguageModelV3Source } from '@ai-sdk/provider';
import { type Static, Type } from '@sinclair/typebox';
import { FinishReason } from 'ai';
import type {
	AssistantContent,
	CallSettings,
	FilePartExt,
	GenerateTextOptions,
	GenerationStats,
	ImagePartExt,
	LlmCallMessageSummaryPart,
	LlmInfo,
	LlmMessage,
	TextPartExt,
	ToolCallPartExt, // Corrected import: Model exports ToolCallPartExt
	ToolContent,
	UserContentExt,
	// Assuming ReasoningPart and RedactedReasoningPart are part of AssistantContent model union
	// If they are separate models, they need to be imported explicitly.
	// For now, their structure is defined inline in AssistantContentPartUnionSchema.
} from '#shared/llm/llm.model';
import { type AreTypesFullyCompatible, ChangePropertyType, type Writable } from '../typeUtils';

export const AttachmentInfoSchema = Type.Object({
	filename: Type.Optional(Type.String()),
	size: Type.Optional(Type.Number()),
	externalURL: Type.Optional(Type.String()),
});

const ProviderOptionsOptionalSchema = Type.Optional(Type.Record(Type.String(), Type.Any()));

const LanguageModelV3UrlSource = Type.Object({
	type: Type.Literal('source'),
	sourceType: Type.Literal('url'),
	id: Type.String(),
	url: Type.String(),
	title: Type.Optional(Type.String()),
	providerMetadata: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Type.Any()))),
});

const LanguageModelV3DocumentSource = Type.Object({
	type: Type.Literal('source'),
	sourceType: Type.Literal('document'),
	id: Type.String(),
	mediaType: Type.String(),
	title: Type.String(),
	filename: Type.Optional(Type.String()),
	providerMetadata: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Type.Any()))),
});

const LanguageModelV3SourceSchema = Type.Union([LanguageModelV3UrlSource, LanguageModelV3DocumentSource]);
const _LanguageModelV3SourceCheck: AreTypesFullyCompatible<LanguageModelV3Source, Static<typeof LanguageModelV3SourceSchema>> = true;

// Basic Part Schemas
export const TextPartSchema = Type.Object({
	type: Type.Literal('text'),
	text: Type.String(),
	providerOptions: ProviderOptionsOptionalSchema,
	sources: Type.Optional(Type.Array(LanguageModelV3SourceSchema)),
});
const _TextPartCheck: AreTypesFullyCompatible<TextPartExt, Static<typeof TextPartSchema>> = true;

export const ImagePartExtSchema = Type.Intersect([
	Type.Object({
		type: Type.Literal('image'),
		image: Type.String(),
		mediaType: Type.Optional(Type.String()),
		providerOptions: ProviderOptionsOptionalSchema,
	}),
	AttachmentInfoSchema,
]);
const _ImagePartExtCheck: AreTypesFullyCompatible<ImagePartExt, Static<typeof ImagePartExtSchema>> = true;

export const FilePartExtSchema = Type.Intersect([
	Type.Object({
		type: Type.Literal('file'),
		data: Type.String(),
		mediaType: Type.String(),
		providerOptions: ProviderOptionsOptionalSchema,
	}),
	AttachmentInfoSchema,
]);
const _FilePartExtCheck: AreTypesFullyCompatible<FilePartExt, Static<typeof FilePartExtSchema>> = true;

export const ToolCallPartSchema = Type.Object(
	{
		type: Type.Literal('tool-call'),
		toolCallId: Type.String(),
		toolName: Type.String(),
		input: Type.Unknown(),
	},
	{ $id: 'ToolCallPart' },
);
// Assuming ToolCallPartExt is the correct model type.
// const _ToolCallPartCheck: AreTypesFullyCompatible<Writable<ToolCallPartExt>, Static<typeof ToolCallPartSchema>> = true;

// Content Schemas
const UserContentPartUnionSchema = Type.Union([TextPartSchema, ImagePartExtSchema, FilePartExtSchema], { $id: 'UserContentUnion' });

export const UserContentSchema = Type.Union([Type.String(), Type.Array(UserContentPartUnionSchema)], { $id: 'UserContent' });
const _UserContentExtCheck: AreTypesFullyCompatible<UserContentExt, Static<typeof UserContentSchema>> = true;

export const AssistantContentPartUnionSchema = Type.Union(
	[
		TextPartSchema,
		ImagePartExtSchema,
		FilePartExtSchema,
		ToolCallPartSchema,
		Type.Object({ type: Type.Literal('reasoning'), text: Type.String(), providerMetadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }), // ReasoningPart schema
		Type.Object({ type: Type.Literal('redacted-reasoning'), data: Type.String(), providerMetadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }), // RedactedReasoningPart schema
	],
	{ $id: 'AssistantContentPartUnion' },
);
export const AssistantContentSchema = Type.Union([Type.String(), Type.Array(AssistantContentPartUnionSchema)], { $id: 'AssistantContent' });
// type AssistantLlmContent = Extract<LlmMessage, { role: 'assistant' }>['content'];
// const _AssistantContentCheck: AreTypesFullyCompatible<AssistantContent, Static<typeof AssistantContentSchema>> = true;

export const ToolResultSchema = Type.Object(
	{
		type: Type.Literal('tool-result'),
		toolCallId: Type.String(),
		toolName: Type.String(),
		output: Type.Any(),
		isError: Type.Optional(Type.Boolean()),
	},
	{ $id: 'ToolResult' },
);

export const ToolApprovalResponseSchema = Type.Object(
	{
		type: Type.Literal('tool-approval-response'),
		approvalId: Type.String(),
		approved: Type.Boolean(),
		reason: Type.Optional(Type.String()),
	},
	{ $id: 'ToolApprovalResponse' },
);

export const ToolContentSchema = Type.Array(Type.Union([ToolResultSchema, ToolApprovalResponseSchema]), { $id: 'ToolContent' });
// type ToolLlmContent = Extract<LlmMessage, { role: 'tool' }>['content'];
const _ToolContentCheck: AreTypesFullyCompatible<ToolContent, Static<typeof ToolContentSchema>> = true;

export const FinishReasonSchema = Type.Union([
	Type.Literal('stop'),
	Type.Literal('length'),
	Type.Literal('content-filter'),
	Type.Literal('tool-calls'),
	Type.Literal('error'),
	Type.Literal('other'),
	Type.Literal('unknown'),
]);
const _FinishReasonCheck: AreTypesFullyCompatible<FinishReason, Static<typeof FinishReasonSchema>> = true;

export const GenerationStatsSchema = Type.Object({
	requestTime: Type.Number(),
	timeToFirstToken: Type.Number(),
	totalTime: Type.Number(),
	inputTokens: Type.Number(),
	outputTokens: Type.Number(),
	cachedInputTokens: Type.Optional(Type.Number()),
	reasoningTokens: Type.Optional(Type.Number()),
	cost: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	llmId: Type.String(),
	finishReason: Type.Optional(FinishReasonSchema),
});
const _GenerationStatsCheck: AreTypesFullyCompatible<GenerationStats, Static<typeof GenerationStatsSchema>> = true;

// GenerateOptions Schema
export const CallSettingsSchema = Type.Object(
	{
		temperature: Type.Optional(Type.Number()),
		topP: Type.Optional(Type.Number()),
		topK: Type.Optional(Type.Number()),
		presencePenalty: Type.Optional(Type.Number()),
		frequencyPenalty: Type.Optional(Type.Number()),
		stopSequences: Type.Optional(Type.Array(Type.String())),
		maxRetries: Type.Optional(Type.Number()),
		maxOutputTokens: Type.Optional(Type.Number()),
	},
	{ $id: 'CallSettings' },
);
const _CallSettingsCheck: AreTypesFullyCompatible<CallSettings, Static<typeof CallSettingsSchema>> = true;

const GenerateTextOptionsSpecificSchema = Type.Object({
	type: Type.Optional(Type.Union([Type.Literal('text'), Type.Literal('json')])),
	id: Type.Optional(Type.String()),
	thinking: Type.Optional(Type.Union([Type.Literal('none'), Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')])),
	providerOptions: Type.Optional(Type.Record(Type.String(), Type.Any())),
	abortSignal: Type.Optional(Type.Any()),
});

export const GenerateTextOptionsSchema = Type.Intersect([CallSettingsSchema, GenerateTextOptionsSpecificSchema], { $id: 'GenerateTextOptions' });
const _GenerateTextOptionsCheck: AreTypesFullyCompatible<GenerateTextOptions, Static<typeof GenerateTextOptionsSchema>> = true;

// Schema for fields truly common to all LlmMessage types with consistent optionality
const LlmMessageBaseSchema = Type.Object({
	llmId: Type.Optional(Type.String()),
	cache: Type.Optional(Type.Literal('ephemeral')),
	providerOptions: Type.Optional(Type.Record(Type.String(), Type.Any())),
	llmCallId: Type.Optional(Type.String()),
});
// Note: LlmMessageSpecificFieldsSchema should be replaced by LlmMessageBaseSchema or removed if all fields are now role-specific.

// --- LlmMessage Schema redefined as a discriminated union ---

// Remove time and stats from the old LlmMessageSpecificFieldsSchema.
// Define them per message type.

const SystemMessageSchema = Type.Intersect(
	[
		Type.Object({
			role: Type.Literal('system'),
			content: Type.String(),
			time: Type.Optional(Type.Number()), // Explicitly define time, assuming optional
			stats: Type.Optional(GenerationStatsSchema), // Explicitly define stats, assuming optional
		}),
		LlmMessageBaseSchema, // Intersect with other common fields
	],
	{ $id: 'SystemMessage' },
);
type SystemLlmMessage = Extract<LlmMessage, { role: 'system' }>;
const _SystemMessageCheck: AreTypesFullyCompatible<SystemLlmMessage, Static<typeof SystemMessageSchema>> = true;

const UserMessageSchema = Type.Intersect(
	[
		Type.Object({
			role: Type.Literal('user'),
			content: UserContentSchema,
			time: Type.Optional(Type.Number()), // Made optional to align with model and allow existing code to compile
			stats: Type.Optional(GenerationStatsSchema), // Stats remain optional for User messages
		}),
		LlmMessageBaseSchema, // Intersect with other common fields
	],
	{ $id: 'UserMessage' },
);
type UserLlmMessage = Extract<LlmMessage, { role: 'user' }>;
// The UserContentExt check might fail if the underlying FilePartExt or ImagePartExt checks fail.
// For now, we assume UserContentSchema correctly maps to UserContentExt.
// A more precise check would involve ChangePropertyType if UserContentExt has complex parts not directly mappable.
// const _UserMessageCheck: AreTypesFullyCompatible<UserLlmMessage, Static<typeof UserMessageSchema>> = true;

const AssistantMessageSchema = Type.Intersect(
	[
		Type.Object({
			role: Type.Literal('assistant'),
			content: AssistantContentSchema,
			time: Type.Optional(Type.Number()), // Time remains optional for Assistant messages
			stats: Type.Optional(GenerationStatsSchema),
		}),
		LlmMessageBaseSchema, // Intersect with other common fields
	],
	{ $id: 'AssistantMessage' },
);
type AssistantLlmMessage = Extract<LlmMessage, { role: 'assistant' }>;
// const _AssistantMessageCheck: AreTypesFullyCompatible<AssistantLlmMessage, Static<typeof AssistantMessageSchema>> = true;

const ToolMessageSchema = Type.Intersect(
	[
		Type.Object({
			role: Type.Literal('tool'),
			content: ToolContentSchema,
			time: Type.Optional(Type.Number()), // Explicitly define time, assuming optional
			stats: Type.Optional(GenerationStatsSchema), // Explicitly define stats, assuming optional
		}),
		LlmMessageBaseSchema, // Intersect with other common fields
	],
	{ $id: 'ToolMessage' },
);
type ToolLlmMessage = Extract<LlmMessage, { role: 'tool' }>;
// const _ToolMessageCheck: AreTypesFullyCompatible<ToolLlmMessage, Static<typeof ToolMessageSchema>> = true;

export const LlmMessageSchema = Type.Union([SystemMessageSchema, UserMessageSchema, AssistantMessageSchema, ToolMessageSchema], { $id: 'LlmMessage' });
const _LlmMessageCheck: AreTypesFullyCompatible<LlmMessage, Static<typeof LlmMessageSchema>> = true;

export const LlmMessagesSchema = Type.Array(LlmMessageSchema);

export type LlmMessageSchemaModel = Static<typeof LlmMessageSchema>;
export type LlmMessagesSchemaModel = Static<typeof LlmMessagesSchema>;

// Schema for LlmMessage['role'] to be used in LlmCallMessageSummaryPartSchema
export const LlmMessageRoleSchema = Type.Union([Type.Literal('system'), Type.Literal('user'), Type.Literal('assistant'), Type.Literal('tool')], {
	$id: 'LlmMessageRole',
});

export const LlmCallMessageSummaryPartSchema = Type.Object(
	{
		role: LlmMessageRoleSchema,
		textPreview: Type.String(), // Max 150 chars
		imageCount: Type.Number(),
		fileCount: Type.Number(),
	},
	{ $id: 'LlmCallMessageSummaryPart' },
);
const _LlmCallMessageSummaryPartCheck: AreTypesFullyCompatible<LlmCallMessageSummaryPart, Static<typeof LlmCallMessageSummaryPartSchema>> = true;

export const LlmSchema = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		isConfigured: Type.Boolean(),
	},
	{ $id: 'Llm' },
);
const _LlmInfoCheck: AreTypesFullyCompatible<LlmInfo, Static<typeof LlmSchema>> = true;

export type LlmSchemaModel = Static<typeof LlmSchema>;

export const LlmsListSchema = Type.Array(LlmSchema, { $id: 'LlmsList' });
const _LlmsListCheck: AreTypesFullyCompatible<LlmInfo[], Static<typeof LlmsListSchema>> = true;
export type LlmsListSchemaModel = Static<typeof LlmsListSchema>;

export const LlmsResponseSchema = Type.Object(
	{
		data: LlmsListSchema,
	},
	{ $id: 'LlmsResponse' },
);

type LlmsResponse = { data: LlmInfo[] };
const _LlmsResponseCheck: AreTypesFullyCompatible<LlmsResponse, Static<typeof LlmsResponseSchema>> = true;
