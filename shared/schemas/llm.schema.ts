import {type Static, Type} from '@sinclair/typebox';
import type {
    FilePartExt,
    CallSettings,
    GenerateTextOptions,
    GenerationStats,
    ImagePartExt,
    TextPartExt,
    UserContentExt,
    LlmMessage, // Import LlmMessage
} from '#shared/model/llm.model';
import type {AreTypesFullyCompatible} from '../utils/type-compatibility';
import {ChangePropertyType, type Writable} from '../typeUtils'; // Added Writable import


export const AttachmentInfoSchema = Type.Object({
    filename: Type.Optional(Type.String()),
    size: Type.Optional(Type.Number()),
    externalURL: Type.Optional(Type.String()),
}); // Do not provide an id as it is attached to multiple parent schemas

export const ProviderOptionsOptionalSchema = Type.Optional(Type.Record(Type.String(), Type.Any()))

// Basic Part Schemas
export const TextPartSchema = Type.Object({
    type: Type.Literal('text'),
    text: Type.String(),
    providerOptions: ProviderOptionsOptionalSchema,
    experimental_providerMetadata: Type.Optional(Type.Unknown()), // Added to match potential field in TextPart from 'ai'
}); // Do not provide an id as it is attached to multiple parent schemas

const _TextPartCheck: AreTypesFullyCompatible<TextPartExt, Writable<Static<typeof TextPartSchema>>> = true;

// Schema for ImagePartExt (includes filename, size, externalURL)
// 'image' field represents base64 data or a URL string.
export const ImagePartExtSchema = Type.Intersect([Type.Object({
    type: Type.Literal('image'),
    image: Type.String(), // Represents DataContent (string | Uint8Array | ArrayBuffer | Buffer) or URL. TypeBox handles string for URL/base64.
    mimeType: Type.Optional(Type.String()),
    providerOptions: ProviderOptionsOptionalSchema,
}), AttachmentInfoSchema]); // Do not provide an id as it is attached to multiple parent schemas

const _ImagePartExtCheck: AreTypesFullyCompatible<ImagePartExt, Writable<Static<typeof ImagePartExtSchema>>> = true;

// Schema for FilePartExt (includes filename, size, externalURL)
// 'data' field represents base64 data or a URL string.
export const FilePartExtSchema = Type.Intersect([Type.Object({
    type: Type.Literal('file'),
    data: Type.String(), // Represents DataContent (string | Uint8Array | ArrayBuffer | Buffer) or URL. TypeBox handles string for URL/base64.
    // filename is provided by AttachmentInfoSchema
    mimeType: Type.String(),
    providerOptions: ProviderOptionsOptionalSchema,
}), AttachmentInfoSchema]); // Do not provide an id as it is attached to multiple parent schemas
const _FilePartExtCheck: AreTypesFullyCompatible<FilePartExt, Writable<Static<typeof FilePartExtSchema>>> = true;

export const ToolCallPartSchema = Type.Object({
    type: Type.Literal('tool-call'),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: Type.Any(), // Changed from Type.Record(Type.String(), Type.Any()) to match 'unknown' in model
}, { $id: 'ToolCallPart' });
// const _ToolCallPartCheck: AreTypesFullyCompatible<Writable<ModelToolCallPart>, Static<typeof ToolCallPartSchema>> = true;

// Content Schemas
// UserContentExt is string | Array<TextPart | ImagePartExt | FilePartExt>
const UserContentPartUnionSchema = Type.Union([
    TextPartSchema,
    ImagePartExtSchema,
    FilePartExtSchema
], { $id: 'UserContentUnion' });
export const UserContentSchema = Type.Union([
    Type.String(),
    Type.Array(UserContentPartUnionSchema)
], { $id: 'UserContent' }); // This schema is for UserContentExt
// The UserContentExt check might fail if the underlying FilePartExt or ImagePartExt checks fail, or if UserContentExt itself has subtle differences.
const _UserContentExtCheck: AreTypesFullyCompatible<UserContentExt, Writable<Static<typeof UserContentSchema>>> = true;

// AssistantContent is string | Array<TextPart | ImagePartExt | FilePartExt | ToolCallPart>
export const AssistantContentPartUnionSchema = Type.Union([
    TextPartSchema,
    ImagePartExtSchema, // Added to support images
    FilePartExtSchema,  // Added to support files
    ToolCallPartSchema,
    Type.Object({ type: Type.Literal('reasoning'), text: Type.String(), providerMetadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }), // ReasoningPart schema
    Type.Object({ type: Type.Literal('redacted-reasoning'), data: Type.String(), providerMetadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }) // RedactedReasoningPart schema
], { $id: 'AssistantContentPartUnion' });
export const AssistantContentSchema = Type.Union([
    Type.String(),
    Type.Array(AssistantContentPartUnionSchema)
], { $id: 'AssistantContent' });
// const _AssistantContentCheck: AreTypesFullyCompatible<AssistantContent, Static<typeof AssistantContentSchema>> = true;

// ToolContent is Array<{ type: 'tool-result', toolCallId: string, toolName: string, result: any, isError?: boolean }>
export const ToolResultSchema = Type.Object({
    type: Type.Literal('tool-result'),
    toolCallId: Type.String(),
    toolName: Type.String(),
    result: Type.Any(), // Type.Unknown() might be more accurate if result can be anything including undefined
    isError: Type.Optional(Type.Boolean())
}, { $id: 'ToolResult' });
export const ToolContentSchema = Type.Array(ToolResultSchema, { $id: 'ToolContent' });
// Check against an array of Writable elements if ToolContent's elements are readonly
// type WritableToolContentElement = Writable<ToolContent[number]>;
// const _ToolContentCheck: AreTypesFullyCompatible<WritableToolContentElement[], Static<typeof ToolContentSchema>> = true;

export const GenerationStatsSchema = Type.Object({
    requestTime: Type.Number(),
    timeToFirstToken: Type.Number(),
    totalTime: Type.Number(),
    inputTokens: Type.Number(),
    outputTokens: Type.Number(),
    cachedInputTokens: Type.Optional(Type.Number()),
    cost: Type.Number(),
    llmId: Type.String(),
}); // Do not provide an id as it is attached to multiple parent schemas
const _GenerationStatsCheck: AreTypesFullyCompatible<GenerationStats, Writable<Static<typeof GenerationStatsSchema>>> = true;

// --- LlmMessage Schema redefined as a discriminated union ---

const LlmMessageSpecificFieldsSchema = Type.Object({
    llmId: Type.Optional(Type.String()),
    cache: Type.Optional(Type.Literal('ephemeral')),
    time: Type.Optional(Type.Number()),
    stats: Type.Optional(GenerationStatsSchema),
    providerOptions: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

const SystemMessageSchema = Type.Intersect([
    Type.Object({
        role: Type.Literal('system'),
        content: Type.String(),
    }),
    LlmMessageSpecificFieldsSchema
], { $id: 'SystemMessage' });
type SystemLlmMessage = Extract<LlmMessage, { role: 'system' }>;
const _SystemMessageCheck: AreTypesFullyCompatible<SystemLlmMessage, Writable<Static<typeof SystemMessageSchema>>> = true;

const UserMessageSchema = Type.Intersect([
    Type.Object({
        role: Type.Literal('user'),
        content: UserContentSchema, // UserContentSchema maps to UserContentExt
    }),
    LlmMessageSpecificFieldsSchema
], { $id: 'UserMessage' });

const AssistantMessageSchema = Type.Intersect([
    Type.Object({
        role: Type.Literal('assistant'),
        content: AssistantContentSchema, // AssistantContentSchema maps to AssistantContent from 'ai'
    }),
    LlmMessageSpecificFieldsSchema
], { $id: 'AssistantMessage' });

const ToolMessageSchema = Type.Intersect([
    Type.Object({
        role: Type.Literal('tool'),
        content: ToolContentSchema, // ToolContentSchema maps to ToolContent from 'ai'
        // tool_call_id and name are not part of CoreToolMessage wrapper in 'ai' model,
        // they are within the ToolContent parts. So, not adding them here.
    }),
    LlmMessageSpecificFieldsSchema
], { $id: 'ToolMessage' });

export const LlmMessageSchema = Type.Union([
    SystemMessageSchema,
    UserMessageSchema,
    AssistantMessageSchema,
    ToolMessageSchema // Added ToolMessageSchema
], { $id: 'LlmMessage' });
// We will need to do some Type conversions for it to match at some point. Dont edit this.
const _LlmMessageCheck: AreTypesFullyCompatible<LlmMessage, Writable<Static<typeof LlmMessageSchema>>> = true;

// GenerateOptions Schema
export const CallSettingsSchema = Type.Object({
    temperature: Type.Optional(Type.Number()),
    topP: Type.Optional(Type.Number()),
    topK: Type.Optional(Type.Number()),
    presencePenalty: Type.Optional(Type.Number()),
    frequencyPenalty: Type.Optional(Type.Number()),
    stopSequences: Type.Optional(Type.Array(Type.String())),
    maxRetries: Type.Optional(Type.Number()),
    maxOutputTokens: Type.Optional(Type.Number()),
}, { $id: 'CallSettings' });
const _CallSettingsCheck: AreTypesFullyCompatible<CallSettings, Writable<Static<typeof CallSettingsSchema>>> = true;

// Schema for properties specific to GenerateTextOptions
const GenerateTextOptionsSpecificSchema = Type.Object({
    type: Type.Optional(Type.Union([Type.Literal('text'), Type.Literal('json')])),
    id: Type.Optional(Type.String()),
    thinking: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')])),
});

export const GenerateTextOptionsSchema = Type.Intersect(
    [
        CallSettingsSchema,
        GenerateTextOptionsSpecificSchema
    ],
    { $id: 'GenerateTextOptions' }
);
const _GenerateTextOptionsCheck: AreTypesFullyCompatible<GenerateTextOptions, Writable<Static<typeof GenerateTextOptionsSchema>>> = true;

export const LlmMessagesSchema = Type.Array(LlmMessageSchema)

export type LlmMessageSchemaModel = Static<typeof LlmMessageSchema>
export type LlmMessagesSchemaModel = Static<typeof LlmMessagesSchema>
