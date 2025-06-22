import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/index';
import { getLLM } from '#llm/llmFactory';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { Chat } from '#shared/chat/chat.model';
import type { ChatMessageSendSchema, ChatParamsSchema } from '#shared/chat/chat.schema';
import { type LLM, type LlmMessage, type TextPartExt, type UserContentExt, contentText } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { getMarkdownFormatPrompt } from './chatPromptUtils';

export async function sendMessageRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, CHAT_API.sendMessage, async (req, reply) => {
		const { chatId } = req.params as Static<typeof ChatParamsSchema>;
		const { llmId, userContent, options, autoReformat } = req.body as Static<typeof ChatMessageSendSchema>;

		let currentUserContent: UserContentExt = userContent as UserContentExt;

		const chat: Chat = await fastify.chatService.loadChat(chatId);
		if (chat.userId !== currentUser().id) return sendBadRequest(reply, 'Unauthorized to send message to this chat');

		let llmInstance: LLM;
		try {
			llmInstance = getLLM(llmId);
		} catch (e) {
			return sendBadRequest(reply, `Cannot find LLM ${llmId}`);
		}
		if (!llmInstance.isConfigured()) return sendBadRequest(reply, `LLM ${llmInstance.getId()} is not configured`);

		if (autoReformat) {
			const originalText = contentText(currentUserContent);
			if (originalText && originalText.trim() !== '') {
				const formattingPrompt = getMarkdownFormatPrompt(originalText);
				const formattingLlm = defaultLLMs().medium;
				try {
					logger.info(
						{ chatId, llmId: formattingLlm.getId(), usingLlm: formattingLlm.getId() },
						'Attempting to auto-reformat message content for existing chat.',
					);
					const formattedText = await formattingLlm.generateText(formattingPrompt, { id: 'chat-auto-format' });
					if (typeof currentUserContent === 'string') {
						currentUserContent = formattedText;
					} else if (Array.isArray(currentUserContent)) {
						const textPartIndex = currentUserContent.findIndex((part) => part.type === 'text');
						if (textPartIndex !== -1) {
							const newParts = [...currentUserContent];
							const partToUpdate = newParts[textPartIndex];
							if (partToUpdate.type === 'text') {
								newParts[textPartIndex] = { ...partToUpdate, text: formattedText };
								currentUserContent = newParts;
							} else {
								logger.warn(
									{ chatId, partType: partToUpdate.type },
									'Auto-reformat: Expected a text part at index but found different type for existing chat.',
								);
							}
						} else {
							const newTextPart: TextPartExt = { type: 'text', text: formattedText };
							currentUserContent = [newTextPart, ...currentUserContent];
						}
					}
					logger.info({ chatId }, 'Message content auto-reformatted successfully for existing chat.');
				} catch (formatError) {
					logger.error({ err: formatError, chatId }, 'Failed to auto-reformat message content for existing chat. Proceeding with original.');
				}
			}
		}

		chat.messages.push({ role: 'user', content: currentUserContent, time: Date.now() });

		const responseMessage: LlmMessage = await llmInstance.generateMessage(chat.messages, { id: 'chat', ...options });
		chat.messages.push(responseMessage);

		await fastify.chatService.saveChat(chat);

		console.log(responseMessage);
		console.log(JSON.stringify(responseMessage));
		reply.sendJSON(responseMessage);
	});
}
