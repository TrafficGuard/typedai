import { RouteDefinition, defineRoute } from '#shared/api-definitions';
import {
	ChatListSchema,
	ChatMarkdownRequestSchema,
	ChatMarkdownResponseSchema,
	ChatMessageSendSchema,
	ChatModelSchema,
	ChatParamsSchema,
	ChatUpdateDetailsSchema,
	RegenerateMessageSchema,
} from '#shared/chat/chat.schema';
import { ApiNullResponseSchema } from '#shared/common.schema';
import { LlmMessageSchema } from '#shared/llm/llm.schema';

const CHAT_BASE = '/api/chat';
const CHATS_BASE = '/api/chats';

export const CHAT_API = {
	listChats: defineRoute('GET', CHATS_BASE, {
		schema: {
			response: {
				200: ChatListSchema,
			},
		},
	}),
	createChat: defineRoute('POST', `${CHAT_BASE}/new`, {
		schema: {
			body: ChatMessageSendSchema,
			response: {
				// Assuming 201 Created for new resources
				201: ChatModelSchema, // Or 200 if preferred
			},
		},
	}),
	getById: defineRoute('GET', `${CHAT_BASE}/:chatId`, {
		schema: {
			params: ChatParamsSchema,
			response: {
				200: ChatModelSchema,
			},
		},
	}),
	deleteChat: defineRoute('DELETE', `${CHAT_BASE}/:chatId`, {
		schema: {
			params: ChatParamsSchema,
			response: {
				204: ApiNullResponseSchema,
			},
		},
	}),
	updateDetails: defineRoute('PATCH', `${CHAT_BASE}/:chatId/details`, {
		schema: {
			params: ChatParamsSchema,
			body: ChatUpdateDetailsSchema,
			response: {
				200: ChatModelSchema,
			},
		},
	}),
	sendMessage: defineRoute('POST', `${CHAT_BASE}/:chatId/send`, {
		schema: {
			params: ChatParamsSchema,
			body: ChatMessageSendSchema,
			response: {
				200: LlmMessageSchema,
			},
		},
	}),
	regenerateMessage: defineRoute('POST', `${CHAT_BASE}/:chatId/regenerate`, {
		schema: {
			params: ChatParamsSchema,
			body: RegenerateMessageSchema,
			response: {
				200: LlmMessageSchema,
			},
		},
	}),
	formatAsMarkdown: defineRoute('POST', `${CHAT_BASE}/markdown`, {
		schema: {
			body: ChatMarkdownRequestSchema,
			response: {
				200: ChatMarkdownResponseSchema,
			},
		},
	}),
};
