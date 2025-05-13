import { Type, type Static } from '@sinclair/typebox';
import type { Chat, ChatPreview, ChatList } from '#shared/model/chat.model';
import {
	LlmMessageSchema,
	UserContentSchema,
	GenerateOptionsSchema
} from './llm.schema';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';
import {ChangePropertyType} from "#shared/typeUtils";

const LlmMessagesSchema = Type.Array(LlmMessageSchema)

// Chat Model Schemas
export const ChatModelSchema = Type.Object({
	id: Type.String(),
	userId: Type.String(),
	shareable: Type.Boolean(),
	title: Type.String(),
	updatedAt: Type.Number(),
	parentId: Type.Optional(Type.String()),
	rootId: Type.Optional(Type.String()),
	messages: LlmMessagesSchema,
}, { $id: 'Chat' });
// DO NOT CHANGE THIS PART ----
// LlmMessageSchema doesnt exactly map to LlmMessage, but lets assume it does for now
type ChatHack = ChangePropertyType<Chat, 'messages', Static<typeof LlmMessagesSchema>>
const _ChatCheck: AreTypesFullyCompatible<ChatHack, Static<typeof ChatModelSchema>> = true;
// -----

export const ChatPreviewProps = ['id', 'userId', 'shareable', 'title', 'updatedAt', 'parentId', 'rootId'] as const;
export const ChatPreviewSchema = Type.Pick(ChatModelSchema, ChatPreviewProps, { $id: 'ChatPreview' });
const _ChatPreviewCheck: AreTypesFullyCompatible<ChatPreview, Static<typeof ChatPreviewSchema>> = true;

export const ChatListSchema = Type.Object({
	chats: Type.Array(ChatPreviewSchema),
	hasMore: Type.Boolean(),
}, { $id: 'ChatList' });
const _ChatListCheck: AreTypesFullyCompatible<ChatList, Static<typeof ChatListSchema>> = true;

// API Specific Schemas

// Parameters for routes like /api/chat/:chatId
export const ChatParamsSchema = Type.Object({
	chatId: Type.String(),
}, { $id: 'ChatParams' });
export type ChatParams = Static<typeof ChatParamsSchema>;

// Request body for POST /api/chat/new and POST /api/chat/:chatId/send
export const ChatMessageSendSchema = Type.Object({
	llmId: Type.String(),
	userContent: UserContentSchema, // UserContentSchema from llm.schema.ts (represents UserContentExt)
	options: Type.Optional(GenerateOptionsSchema),
}, { $id: 'ChatMessageSend' });
export type ChatMessagePayload = Static<typeof ChatMessageSendSchema>;

// Response for DELETE /api/chat/:chatId
export const DeleteChatSuccessResponseSchema = Type.Object({
	success: Type.Boolean()
}, { $id: 'DeleteChatSuccessResponse' });
export type DeleteChatSuccessResponse = Static<typeof DeleteChatSuccessResponseSchema>;
