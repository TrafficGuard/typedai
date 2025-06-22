import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/index';
import { getLLM } from '#llm/llmFactory';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { Chat } from '#shared/chat/chat.model';
import type { ChatParamsSchema, RegenerateMessageSchema } from '#shared/chat/chat.schema';
import type { LLM, LlmMessage, UserContentExt } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export async function regenerateMessageRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, CHAT_API.regenerateMessage, async (req, reply) => {
		const { chatId } = req.params as Static<typeof ChatParamsSchema>;
		const { userContent, llmId, historyTruncateIndex, options } = req.body as Static<typeof RegenerateMessageSchema>;
		const userId = currentUser().id;

		const chat: Chat = await fastify.chatService.loadChat(chatId);
		if (chat.userId !== userId) {
			return sendBadRequest(reply, 'Unauthorized to regenerate this chat');
		}

		let llmInstance: LLM;
		try {
			llmInstance = getLLM(llmId);
		} catch (e) {
			return sendBadRequest(reply, `Cannot find LLM ${llmId}`);
		}
		if (!llmInstance.isConfigured()) return sendBadRequest(reply, `LLM ${llmId} is not configured`);

		if (historyTruncateIndex <= 0 || historyTruncateIndex > chat.messages.length + 1) {
			return sendBadRequest(reply, `Invalid historyTruncateIndex. Must be > 0 and <= ${chat.messages.length + 1}. Received: ${historyTruncateIndex}`);
		}

		chat.messages = chat.messages.slice(0, historyTruncateIndex - 1);

		chat.messages.push({ role: 'user', content: userContent as UserContentExt, time: Date.now() });

		const responseMessage: LlmMessage = await llmInstance.generateMessage(chat.messages, { id: 'chat-regenerate', ...options });
		chat.messages.push(responseMessage);
		chat.updatedAt = Date.now();

		await fastify.chatService.saveChat(chat);
		reply.sendJSON(responseMessage);
	});
}
