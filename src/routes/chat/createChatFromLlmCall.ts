import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendErrorResponse, sendNotFound } from '#fastify/responses';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { Chat } from '#shared/chat/chat.model';
import { currentUser } from '#user/userContext';

export function createChatFromLlmCallRoute(fastify: AppFastifyInstance): void {
	registerApiRoute(fastify, CHAT_API.createChatFromLlmCall, async (req, reply) => {
		const { llmCallId } = req.body;

		const llmCall = await fastify.llmCallService.getLlmCallDetail(llmCallId);
		if (!llmCall) return sendNotFound(reply, 'LLM call not found.');

		const user = currentUser();
		if (llmCall.userId !== user.id) return sendErrorResponse(reply, 403, 'You do not have permission to access this LLM call.');

		const chat: Chat = {
			id: undefined as any, // The service layer will generate the ID
			messages: llmCall.messages,
			title: llmCall.description || `Chat from LLM Call ${llmCall.id}`,
			updatedAt: Date.now(),
			userId: user.id,
			shareable: false,
			parentId: undefined,
			rootId: undefined,
		};

		const savedChat = await fastify.chatService.saveChat(chat);
		if (!savedChat) return sendNotFound(reply, 'Failed to save chat');

		reply.sendJSON(savedChat);
	});
}
