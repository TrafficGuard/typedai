import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/index';
import { getLLM } from '#llm/llmFactory';
import { defaultLLMs, summaryLLM } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { Chat } from '#shared/chat/chat.model';
import type { ChatMessageSendSchema } from '#shared/chat/chat.schema';
import { type LLM, type LlmMessage, type TextPartExt, type UserContentExt, contentText } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { getMarkdownFormatPrompt } from './chatPromptUtils';

export async function createChatRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, CHAT_API.createChat, async (req, reply) => {
		const { llmId, userContent, options, autoReformat } = req.body as Static<typeof ChatMessageSendSchema>;

		let currentUserContent: UserContentExt = userContent as UserContentExt;

		// id is 'string' in Chat model, but undefined when creating a new chat before saving.
		// The service layer (saveChat) is expected to handle ID generation.
		// Using 'as any' for 'id' in the initial object to align with original logic's implications.
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

		let llmInstance: LLM;
		try {
			llmInstance = getLLM(llmId);
		} catch (e) {
			return sendBadRequest(reply, `No LLM for ${llmId}`);
		}
		if (!llmInstance.isConfigured()) return sendBadRequest(reply, `LLM ${llmInstance.getId()} is not configured`);

		if (autoReformat) {
			const originalText = contentText(currentUserContent);
			if (originalText && originalText.trim() !== '') {
				const formattingPrompt = getMarkdownFormatPrompt(originalText);
				const formattingLlm = defaultLLMs().medium;

				try {
					logger.info(
						{ chatId: chat.id, llmId: formattingLlm.getId(), usingLlm: formattingLlm.getId() },
						'Attempting to auto-reformat message content for new chat.',
					);
					const formattedText = await formattingLlm.generateText(formattingPrompt, { id: 'chat-auto-format' });
					console.log(formattedText);
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
									{ chatId: chat.id, partType: partToUpdate.type },
									'Auto-reformat: Expected a text part at index but found different type during new chat creation.',
								);
							}
						} else {
							const newTextPart: TextPartExt = { type: 'text', text: formattedText };
							currentUserContent = [newTextPart, ...currentUserContent];
						}
					}
					logger.info({ chatId: chat.id }, 'Message content auto-reformatted successfully for new chat.');
				} catch (formatError) {
					logger.error({ err: formatError, chatId: chat.id }, 'Failed to auto-reformat message content for new chat. Proceeding with original.');
				}
			}
		}

		const textForTitle = contentText(currentUserContent);

		const titleLLM = summaryLLM().isConfigured() ? summaryLLM() : llmInstance;
		const titlePromise: Promise<string> | undefined = titleLLM.generateText(
			`<message>\n${textForTitle}\n</message>\n\n\nThe above message is the first message in a new chat conversation. Your task is to create a short title in a few words for the conversation. Respond only with the title, nothing else.`,
			{ id: 'Chat title' },
		);

		chat.messages.push({ role: 'user', content: currentUserContent, time: Date.now() });

		const responseMessage: LlmMessage = await llmInstance.generateMessage(chat.messages, { id: 'chat', ...options });
		chat.messages.push(responseMessage);

		if (titlePromise) chat.title = await titlePromise;

		const savedChat = await fastify.chatService.saveChat(chat);

		reply.code(201).sendJSON(savedChat);
	});
}
