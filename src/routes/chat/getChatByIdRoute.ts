import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/index';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { Chat } from '#shared/chat/chat.model';
import type { ChatParamsSchema } from '#shared/chat/chat.schema';
import { currentUser } from '#user/userContext';

export async function getChatByIdRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CHAT_API.getById, async (req, reply) => {
		const { chatId } = req.params;
		const chat: Chat = await fastify.chatService.loadChat(chatId);

		if (chat.shareable) return reply.sendJSON(chat);

		const userId = currentUser().id;
		if (chat.userId !== userId) return sendBadRequest(reply, 'Unauthorized to view this chat');

		reply.sendJSON(chat);
	});
}
