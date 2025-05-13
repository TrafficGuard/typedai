import { Type, type Static } from '@sinclair/typebox';
import type {
    LlmMessage,
    // UserContent, // This is UserContent from 'ai' - UserContentExt is used for LlmMessage
    GenerateOptions,
    TextPartExt,
    // ImagePart, // from 'ai' - ImagePartExt is used
    // FilePart,  // from 'ai' - FilePartExt is used
    GenerationStats,
    ImagePartExt, // Extended type from llm.model.ts
    FilePartExt,  // Extended type from llm.model.ts
    UserContentExt, // Extended type from llm.model.ts, used in LlmMessage
} from '#shared/model/llm.model';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';
import {ChangePropertyType, Writable} from '../typeUtils';

export const AttachmentInfoSchema = Type.Object({
    // type: Type.Literal('image'),
    // image: Type.String(), // Represents DataContent (string | Uint8Array | ArrayBuffer | Buffer) or URL. TypeBox handles string for URL/base64.
    // mimeType: Type.Optional(Type.String()),
    filename: Type.Optional(Type.String()), // from AttachmentInfo
    size: Type.Optional(Type.Number()), // from AttachmentInfo
    externalURL: Type.Optional(Type.String()), // from AttachmentInfo
}, { $id: 'ImagePartExt' });

// Basic Part Schemas
export const TextPartSchema = Type.Object({
    type: Type.Literal('text'),
    text: Type.String(),
    providerOptions: Type.Optional(Type.Record(Type.String(), Type.Record(Type.String(), Type.Any()))),
}, { $id: 'TextPart' });
type TextPartExtType = Omit<ChangePropertyType<TextPartExt, 'providerOptions', Record<string, Record<string, any>>>, 'experimental_providerMetadata'>
const _TextPartCheck: AreTypesFullyCompatible<TextPartExtType, Static<typeof TextPartSchema>> = true;

// Schema for ImagePartExt (includes filename, size, externalURL)
// 'image' field represents base64 data or a URL string.
export const ImagePartExtSchema = Type.Object({
    type: Type.Literal('image'),
    image: Type.String(), // Represents DataContent (string | Uint8Array | ArrayBuffer | Buffer) or URL. TypeBox handles string for URL/base64.
    mimeType: Type.Optional(Type.String()),
    filename: Type.Optional(Type.String()), // from AttachmentInfo
    size: Type.Optional(Type.Number()), // from AttachmentInfo
    externalURL: Type.Optional(Type.String()), // from AttachmentInfo
}, { $id: 'ImagePartExt' });
const _ImagePartExtCheck: AreTypesFullyCompatible<ImagePartExt, Static<typeof ImagePartExtSchema>> = true;

// Schema for FilePartExt (includes filename, size, externalURL)
// 'data' field represents base64 data or a URL string.
export const FilePartExtSchema = Type.Object({
    type: Type.Literal('file'),
    data: Type.String(), // Represents DataContent (string | Uint8Array | ArrayBuffer | Buffer) or URL.
    mimeType: Type.String(),
    filename: Type.Optional(Type.String()), // from AttachmentInfo
    size: Type.Optional(Type.Number()), // from AttachmentInfo
    externalURL: Type.Optional(Type.String()), // from AttachmentInfo
}, { $id: 'FilePartExt' });
const _FilePartExtCheck: AreTypesFullyCompatible<FilePartExt, Static<typeof FilePartExtSchema>> = true;

export const ToolCallPartSchema = Type.Object({
    type: Type.Literal('tool-call'),
    toolCallId: Type.String(),
    toolName: Type.String(),
    args: Type.Record(Type.String(), Type.Any()),
}, { $id: 'ToolCallPart' });
const _ToolCallPartCheck: AreTypesFullyCompatible<Writable<ModelToolCallPart>, Static<typeof ToolCallPartSchema>> = true;

// Content Schemas
// UserContentExt is string | Array<TextPart | ImagePartExt | FilePartExt>
export const UserContentPartUnionSchema = Type.Union([
    TextPartSchema,
    ImagePartExtSchema,
    FilePartExtSchema
], { $id: 'UserContentPartUnion' });
export const UserContentSchema = Type.Union([
    Type.String(),
    Type.Array(UserContentPartUnionSchema)
], { $id: 'UserContent' }); // This schema is for UserContentExt
const _UserContentExtCheck: AreTypesFullyCompatible<UserContentExt, Static<typeof UserContentSchema>> = true;

// AssistantContent is string | Array<TextPart | ToolCallPart>
export const AssistantContentPartUnionSchema = Type.Union([
    TextPartSchema,
    ToolCallPartSchema
], { $id: 'AssistantContentPartUnion' });
export const AssistantContentSchema = Type.Union([
    Type.String(),
    Type.Array(AssistantContentPartUnionSchema)
], { $id: 'AssistantContent' });
const _AssistantContentCheck: AreTypesFullyCompatible<AssistantContent, Static<typeof AssistantContentSchema>> = true;

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
type WritableToolContentElement = Writable<ToolContent[number]>;
const _ToolContentCheck: AreTypesFullyCompatible<WritableToolContentElement[], Static<typeof ToolContentSchema>> = true;

export const GenerationStatsSchema = Type.Object({
    requestTime: Type.Number(),
    timeToFirstToken: Type.Number(),
    totalTime: Type.Number(),
    inputTokens: Type.Number(),
    outputTokens: Type.Number(),
    cachedInputTokens: Type.Optional(Type.Number()),
    cost: Type.Number(),
    llmId: Type.String(),
}, { $id: 'GenerationStats' });
const _GenerationStatsCheck: AreTypesFullyCompatible<GenerationStats, Static<typeof GenerationStatsSchema>> = true;

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
    ToolMessageSchema
], { $id: 'LlmMessage' });
const _LlmMessageCheck: AreTypesFullyCompatible<LlmMessage, Static<typeof LlmMessageSchema>> = true;

// GenerateOptions Schema
export const GenerateOptionsSchema = Type.Object({
    temperature: Type.Optional(Type.Number()),
    topP: Type.Optional(Type.Number()),
    topK: Type.Optional(Type.Number()),
    presencePenalty: Type.Optional(Type.Number()),
    frequencyPenalty: Type.Optional(Type.Number()),
    stopSequences: Type.Optional(Type.Array(Type.String())),
    maxRetries: Type.Optional(Type.Number()),
    maxOutputTokens: Type.Optional(Type.Number()),
}, { $id: 'GenerateOptions' });
const _GenerateOptionsCheck: AreTypesFullyCompatible<GenerateOptions, Static<typeof GenerateOptionsSchema>> = true;
