import { type Static, Type } from '@sinclair/typebox';
import type { Chat, ChatList, ChatPreview } from '#shared/model/chat.model';
import type { ChangePropertyType } from '#shared/typeUtils';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';
import { CallSettingsSchema, LlmMessagesSchema, type LlmMessagesSchemaModel, UserContentSchema } from './llm.schema';

// Chat Model Schemas
export const ChatModelSchema = Type.Object(
	{
		id: Type.String(),
		userId: Type.String(),
		shareable: Type.Boolean(),
		title: Type.String(),
		updatedAt: Type.Number(),
		parentId: Type.Optional(Type.String()),
		rootId: Type.Optional(Type.String()),
		messages: LlmMessagesSchema,
	},
	{ $id: 'Chat' },
);
// DO NOT CHANGE THIS PART ----
// LlmMessageSchema doesnt exactly map to LlmMessage, but lets assume it does for now
type ChatHack = ChangePropertyType<Chat, 'messages', LlmMessagesSchemaModel>;
const _ChatCheck: AreTypesFullyCompatible<ChatHack, Static<typeof ChatModelSchema>> = true;
// -----

export const ChatPreviewProps = ['id', 'userId', 'shareable', 'title', 'updatedAt', 'parentId', 'rootId'] as const;
export const ChatPreviewSchema = Type.Pick(ChatModelSchema, ChatPreviewProps, { $id: 'ChatPreview' });
const _ChatPreviewCheck: AreTypesFullyCompatible<ChatPreview, Static<typeof ChatPreviewSchema>> = true;

export const ChatListSchema = Type.Object(
	{
		chats: Type.Array(ChatPreviewSchema),
		hasMore: Type.Boolean(),
	},
	{ $id: 'ChatList' },
);
const _ChatListCheck: AreTypesFullyCompatible<ChatList, Static<typeof ChatListSchema>> = true;

// API Specific Schemas

// Parameters for routes like /api/chat/:chatId
export const ChatParamsSchema = Type.Object(
	{
		chatId: Type.String(),
	},
	{ $id: 'ChatParams' },
);
export type ChatParams = Static<typeof ChatParamsSchema>;

// Request body for POST /api/chat/new and POST /api/chat/:chatId/send
export const ChatMessageSendSchema = Type.Object(
	{
		llmId: Type.String(),
		userContent: UserContentSchema, // UserContentSchema from llm.schema.ts (represents UserContentExt)
		options: Type.Optional(CallSettingsSchema),
	},
	{ $id: 'ChatMessageSend' },
);
export type ChatMessagePayload = Static<typeof ChatMessageSendSchema>;

// Schema for the request body of PATCH /api/chat/:chatId/details
const ChatUpdatableDetailsProps = ['title', 'shareable'] as const;
export const ChatUpdateDetailsSchema = Type.Partial(Type.Pick(ChatModelSchema, ChatUpdatableDetailsProps), { $id: 'ChatUpdateDetails' });
export type ChatUpdateDetailsPayload = Static<typeof ChatUpdateDetailsSchema>;

// Schema for the request body of POST /api/chat/:chatId/regenerate
export const RegenerateMessageSchema = Type.Object(
	{
		userContent: UserContentSchema, // Renamed 'text' to 'userContent' for consistency
		llmId: Type.String(),
		historyTruncateIndex: Type.Number(),
		options: Type.Optional(CallSettingsSchema),
	},
	{ $id: 'RegenerateMessage' },
);
export type RegenerateMessagePayload = Static<typeof RegenerateMessageSchema>;

// DeleteChatSuccessResponseSchema is not strictly needed if using 204 with ApiNullResponseSchema
// Export Static types for use in frontend/backend
export type ChatListSchemaModel = Static<typeof ChatListSchema>;
export type ChatSchemaModel = Static<typeof ChatModelSchema>;

// Request body for POST /api/chat/markdown
export const ChatMarkdownRequestSchema = Type.Object(
	{
		text: Type.String({ description: 'The text content to be formatted as Markdown.' }),
	},
	{ $id: 'ChatMarkdownRequest' },
);
export type ChatMarkdownRequestPayload = Static<typeof ChatMarkdownRequestSchema>;

// Response body for POST /api/chat/markdown
export const ChatMarkdownResponseSchema = Type.Object(
	{
		markdownText: Type.String({ description: 'The Markdown formatted text.' }),
	},
	{ $id: 'ChatMarkdownResponse' },
);
export type ChatMarkdownResponseModel = Static<typeof ChatMarkdownResponseSchema>;
