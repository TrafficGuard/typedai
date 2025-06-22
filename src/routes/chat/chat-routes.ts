import { randomUUID } from 'node:crypto';
import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest } from '#fastify/index';
import { getLLM } from '#llm/llmFactory';
import { defaultLLMs, summaryLLM } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { CHAT_API } from '#shared/chat/chat.api';
import type { Chat, ChatList } from '#shared/chat/chat.model';
import type {
	ChatMarkdownRequestSchema,
	ChatMarkdownResponseModel,
	ChatMessageSendSchema,
	ChatParamsSchema,
	ChatSchemaModel,
	ChatUpdateDetailsSchema,
	RegenerateMessageSchema,
} from '#shared/chat/chat.schema';
import { contentText } from '#shared/llm/llm.model';
import type { LLM, LlmMessage, TextPartExt, UserContentExt } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { getMarkdownFormatPrompt } from './chatPromptUtils';

export async function chatRoutes(fastify: AppFastifyInstance) {
	fastify.get(
		CHAT_API.getById.pathTemplate,
		{
			schema: CHAT_API.getById.schema,
		},
		async (req, reply) => {
			const { chatId } = req.params as Static<typeof ChatParamsSchema>;
			const userId = currentUser().id;
			const chat: Chat = await fastify.chatService.loadChat(chatId);
			if (chat.userId !== userId) return sendBadRequest(reply, 'Unauthorized to view this chat');
			console.log(JSON.stringify(chat));
			reply.sendJSON(chat);
		},
	);

	fastify.post(
		CHAT_API.createChat.pathTemplate,
		{
			schema: CHAT_API.createChat.schema,
		},
		async (req, reply) => {
			const { llmId, userContent, options, autoReformat } = req.body as Static<typeof ChatMessageSendSchema>;

			let currentUserContent: UserContentExt = userContent as UserContentExt;

			let chat: Chat = {
				id: undefined,
				messages: [],
				title: '',
				updatedAt: Date.now(),
				userId: currentUser().id,
				shareable: false,
				parentId: undefined,
				rootId: undefined,
			};

			let llm: LLM;
			try {
				llm = getLLM(llmId);
			} catch (e) {
				return sendBadRequest(reply, `No LLM for ${llmId}`);
			}
			if (!llm.isConfigured()) return sendBadRequest(reply, `LLM ${llm.getId()} is not configured`);

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
									// This branch should ideally not be hit due to findIndex logic
									logger.warn(
										{ chatId: chat.id, partType: partToUpdate.type },
										'Auto-reformat: Expected a text part at index but found different type during new chat creation.',
									);
								}
							} else {
								// No existing text part, add one at the beginning
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

			const titleLLM = summaryLLM().isConfigured() ? summaryLLM() : llm;
			const titlePromise: Promise<string> | undefined = titleLLM.generateText(
				`<message>\n${textForTitle}\n</message>\n\n\nThe above message is the first message in a new chat conversation. Your task is to create a short title in a few words for the conversation. Respond only with the title, nothing else.`,
				{ id: 'Chat title' },
			);

			chat.messages.push({ role: 'user', content: currentUserContent, time: Date.now() });

			const responseMessage: LlmMessage = await llm.generateMessage(chat.messages, { id: 'chat', ...options });
			chat.messages.push(responseMessage);

			if (titlePromise) chat.title = await titlePromise;

			chat = await fastify.chatService.saveChat(chat);

			reply.code(201).sendJSON(chat);
		},
	);

	fastify.post(
		CHAT_API.sendMessage.pathTemplate,
		{
			schema: CHAT_API.sendMessage.schema,
		},
		async (req, reply) => {
			const { chatId } = req.params as Static<typeof ChatParamsSchema>;
			const { llmId, userContent, options, autoReformat } = req.body as Static<typeof ChatMessageSendSchema>;

			let currentUserContent: UserContentExt = userContent as UserContentExt;

			const chat: Chat = await fastify.chatService.loadChat(chatId);
			if (chat.userId !== currentUser().id) return sendBadRequest(reply, 'Unauthorized to send message to this chat');

			let llm: LLM;
			try {
				llm = getLLM(llmId);
			} catch (e) {
				return sendBadRequest(reply, `Cannot find LLM ${llmId}`);
			}
			if (!llm.isConfigured()) return sendBadRequest(reply, `LLM ${llm.getId()} is not configured`);

			if (autoReformat) {
				const originalText = contentText(currentUserContent);
				if (originalText && originalText.trim() !== '') {
					const formattingPrompt = getMarkdownFormatPrompt(originalText);
					// const formattingPrompt = 'TEMPORARILY_COMMENTED_OUT';
					// Use the LLM instance resolved for this specific send message operation as fallback
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
									// This branch should ideally not be hit due to findIndex logic
									logger.warn(
										{ chatId, partType: partToUpdate.type },
										'Auto-reformat: Expected a text part at index but found different type for existing chat.',
									);
								}
							} else {
								// No existing text part, add one at the beginning
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

			const responseMessage = await llm.generateMessage(chat.messages, { id: 'chat', ...options });
			chat.messages.push(responseMessage);

			await fastify.chatService.saveChat(chat);

			console.log(responseMessage);
			console.log(JSON.stringify(responseMessage));
			reply.sendJSON(responseMessage);
		},
	);

	fastify.post(
		CHAT_API.regenerateMessage.pathTemplate,
		{
			schema: CHAT_API.regenerateMessage.schema,
		},
		async (req, reply) => {
			const { chatId } = req.params as Static<typeof ChatParamsSchema>;
			const { userContent, llmId, historyTruncateIndex, options } = req.body as Static<typeof RegenerateMessageSchema>;
			const userId = currentUser().id;

			const chat: Chat = await fastify.chatService.loadChat(chatId);
			if (chat.userId !== userId) {
				return sendBadRequest(reply, 'Unauthorized to regenerate this chat');
			}

			let llm: LLM;
			try {
				llm = getLLM(llmId);
			} catch (e) {
				return sendBadRequest(reply, `Cannot find LLM ${llmId}`);
			}
			if (!llm.isConfigured()) return sendBadRequest(reply, `LLM ${llmId} is not configured`);

			if (historyTruncateIndex <= 0 || historyTruncateIndex > chat.messages.length + 1) {
				return sendBadRequest(reply, `Invalid historyTruncateIndex. Must be > 0 and <= ${chat.messages.length + 1}. Received: ${historyTruncateIndex}`);
			}

			chat.messages = chat.messages.slice(0, historyTruncateIndex - 1);

			chat.messages.push({ role: 'user', content: userContent as UserContentExt, time: Date.now() });

			const responseMessage = await llm.generateMessage(chat.messages, { id: 'chat-regenerate', ...options });
			chat.messages.push(responseMessage);
			chat.updatedAt = Date.now();

			await fastify.chatService.saveChat(chat);
			reply.sendJSON(responseMessage);
		},
	);

	fastify.get(
		CHAT_API.listChats.pathTemplate,
		{
			schema: CHAT_API.listChats.schema,
		},
		async (req, reply) => {
			// Assuming CHAT_API.listChats.schema.querystring would define any query params
			// const { startAfterId } = req.query as { startAfterId?: string };
			const chats: ChatList = await fastify.chatService.listChats(); // Pass startAfterId if defined in schema and used
			reply.sendJSON(chats);
		},
	);

	fastify.delete(
		CHAT_API.deleteChat.pathTemplate,
		{
			schema: CHAT_API.deleteChat.schema,
		},
		async (req, reply) => {
			const { chatId } = req.params as Static<typeof ChatParamsSchema>;
			const userId = currentUser().id;
			try {
				const chat = await fastify.chatService.loadChat(chatId);
				if (chat.userId !== userId) {
					return sendBadRequest(reply, 'Unauthorized to delete this chat');
				}
				await fastify.chatService.deleteChat(chatId);
				reply.code(204).send(); // 204 No Content, no body, so no sendJSON
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				logger.error({ err: error, chatId, userId }, `Failed to delete chat: ${errorMessage}`);
				// Using custom 'send' helper for error, as per DOCS.md for non-2xx or non-object responses
				send(reply, 500, { error: 'Failed to delete chat' });
			}
		},
	);

	fastify.patch(
		CHAT_API.updateDetails.pathTemplate,
		{
			schema: CHAT_API.updateDetails.schema,
		},
		async (req, reply) => {
			const { chatId } = req.params as Static<typeof ChatParamsSchema>;
			const updates = req.body as Static<typeof ChatUpdateDetailsSchema>; // Use specific schema type
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
		},
	);

	fastify.post(
		CHAT_API.formatAsMarkdown.pathTemplate,
		{
			schema: CHAT_API.formatAsMarkdown.schema,
		},
		async (req, reply) => {
			currentUser(); // Ensures user is authenticated, will throw if not

			const { text } = req.body as Static<typeof ChatMarkdownRequestSchema>;

			const llmToUse = summaryLLM();
			if (!llmToUse.isConfigured()) {
				logger.error('Markdown formatting: summaryLLM is not configured.');
				return send(reply, 503, { error: 'Markdown formatting service is currently unavailable due to LLM configuration.' });
			}

			const prompt = `Please reformat the following text with appropriate Markdown tags. Your response should only contain the Markdown formatted text and nothing else. Do not include any preamble or explanation.
<text_to_format>
${text}
</text_to_format>`;

			try {
				const markdownText = await llmToUse.generateText(prompt, { id: 'markdown-format' });
				reply.sendJSON({ markdownText } as ChatMarkdownResponseModel);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				logger.error({ err: error, inputTextLength: text.length }, `Failed to format text as Markdown: ${errorMessage}`);
				send(reply, 500, { error: 'Failed to format text as Markdown.' });
			}
		},
	);
}
