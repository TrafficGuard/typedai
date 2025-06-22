import type { AppFastifyInstance } from '#app/applicationTypes';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { ChatList } from '#shared/chat/chat.model';

export async function listChatsRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, CHAT_API.listChats, async (req, reply) => {
		const chats: ChatList = await fastify.chatService.listChats();
		reply.sendJSON(chats);
	});
}
