import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/index';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { ChatParamsSchema, ChatSchemaModel, ChatUpdateDetailsSchema } from '#shared/chat/chat.schema';
import { currentUser } from '#user/userContext';

export async function updateChatDetailsRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CHAT_API.updateDetails, async (req, reply) => {
		const { chatId } = req.params as Static<typeof ChatParamsSchema>;
		const updates = req.body as Static<typeof ChatUpdateDetailsSchema>;
		const userId = currentUser().id;

		const chat = await fastify.chatService.loadChat(chatId);
		if (chat.userId !== userId) {
			return sendBadRequest(reply, 'Unauthorized to update this chat');
		}

		if (updates.title !== undefined) chat.title = updates.title;
		if (updates.shareable !== undefined) chat.shareable = updates.shareable;
		chat.updatedAt = Date.now();

		const updatedChat = await fastify.chatService.saveChat(chat);
		reply.sendJSON(updatedChat as ChatSchemaModel);
	});
}
