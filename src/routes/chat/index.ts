import type { AppFastifyInstance } from '#app/applicationTypes';
import { createChatFromLlmCallRoute } from './createChatFromLlmCall';
import { createChatRoute } from './createChatRoute';
import { deleteChatRoute } from './deleteChatRoute';
import { formatAsMarkdownRoute } from './formatAsMarkdownRoute';
import { getChatByIdRoute } from './getChatByIdRoute';
import { listChatsRoute } from './listChatsRoute';
import { regenerateMessageRoute } from './regenerateMessageRoute';
import { sendMessageRoute } from './sendMessageRoute';
import { updateChatDetailsRoute } from './updateChatDetailsRoute';

export async function chatRoutes(fastify: AppFastifyInstance): Promise<void> {
	await getChatByIdRoute(fastify);
	await createChatRoute(fastify);
	await sendMessageRoute(fastify);
	await regenerateMessageRoute(fastify);
	await listChatsRoute(fastify);
	await deleteChatRoute(fastify);
	await updateChatDetailsRoute(fastify);
	await formatAsMarkdownRoute(fastify);
	await createChatFromLlmCallRoute(fastify);
}
