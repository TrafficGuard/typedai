import type { AppFastifyInstance } from '#app/applicationTypes';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { Chat } from '#shared/chat/chat.model';
import { currentUser } from '#user/userContext';

export async function createChatRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CHAT_API.createChat, async (req, reply) => {
		const chat: Chat = {
			id: undefined as any,
			messages: [],
			title: '',
			updatedAt: Date.now(),
			userId: currentUser().id,
			shareable: false,
			parentId: undefined,
			rootId: undefined,
		};
		const savedChat = await fastify.chatService.saveChat(chat);
		reply.sendJSON(savedChat);
	});
}
