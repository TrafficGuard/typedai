import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest } from '#fastify/index';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { ChatParamsSchema } from '#shared/chat/chat.schema';
import { currentUser } from '#user/userContext';

export async function deleteChatRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, CHAT_API.deleteChat, async (req, reply) => {
		const { chatId } = req.params as Static<typeof ChatParamsSchema>;
		const userId = currentUser().id;
		try {
			const chat = await fastify.chatService.loadChat(chatId);
			if (chat.userId !== userId) {
				return sendBadRequest(reply, 'Unauthorized to delete this chat');
			}
			await fastify.chatService.deleteChat(chatId);
			reply.code(204).send();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error({ err: error, chatId, userId }, `Failed to delete chat: ${errorMessage}`);
			send(reply, 500, { error: 'Failed to delete chat' });
		}
	});
}
