import { randomUUID } from 'node:crypto';
import type { MultipartFile } from '@fastify/multipart';
import { Type } from '@sinclair/typebox';
import type { UserContent } from 'ai';
import type { FastifyRequest } from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send, sendBadRequest } from '#fastify/index';
import { getLLM } from '#llm/llmFactory';
import { summaryLLM } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import type { Chat, ChatList } from '#shared/model/chat.model';
import type { FilePartExt, GenerateOptions, ImagePartExt, LLM, LlmMessage, UserContentExt } from '#shared/model/llm.model';
import { currentUser } from '#user/userContext';

const basePath = '/api';

export async function chatRoutes(fastify: AppFastifyInstance) {
	fastify.get(
		`${basePath}/chat/:chatId`,
		{
			schema: {
				params: Type.Object({
					chatId: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const { chatId } = req.params;
			const userId = currentUser().id;
			const chat: Chat = await fastify.chatService.loadChat(chatId);
			if (chat.userId !== userId)	return sendBadRequest(reply, 'Unauthorized to view this chat');

			reply.sendJSON(chat);
		},
	);

	fastify.post(`${basePath}/chat/new`, {}, async (req, reply) => {
		const { llmId, userContent, options } = await extractMessage(req);

		let chat: Chat = {
			id: randomUUID(),
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

		const text = typeof userContent === 'string' ? userContent : userContent.find((content) => content.type === 'text')?.text;
		const titleLLM = summaryLLM().isConfigured() ? summaryLLM() : llm;
		const titlePromise: Promise<string> | undefined = titleLLM.generateText(
			`<message>\n${text}\n</message>\n\n\nThe above message is the first message in a new chat conversation. Your task is to create a short title in a few words for the conversation. Respond only with the title, nothing else.`,
			{ id: 'Chat title' },
		);

		chat.messages.push({ role: 'user', content: userContent, time: Date.now() }); //, cache: cache ? 'ephemeral' : undefined // remove any previous cache marker

		const message: LlmMessage = await llm.generateMessage(chat.messages, { id: 'chat', ...options });
		chat.messages.push(message);

		if (titlePromise) chat.title = await titlePromise;

		chat = await fastify.chatService.saveChat(chat);

		send(reply, 200, chat);
	});
	fastify.post(
		`${basePath}/chat/:chatId/send`,
		{
			schema: {
				params: Type.Object({
					chatId: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const { chatId } = req.params;

			const { llmId, userContent, options } = await extractMessage(req);

			const chat: Chat = await fastify.chatService.loadChat(chatId);

			let llm: LLM;
			try {
				llm = getLLM(llmId);
			} catch (e) {
				return sendBadRequest(reply, `Cannot find LLM ${llm.getId()}`);
			}
			if (!llm.isConfigured()) return sendBadRequest(reply, `LLM ${llm.getId()} is not configured`);

			chat.messages.push({ role: 'user', content: userContent, time: Date.now() });

			const message = await llm.generateMessage(chat.messages, { id: 'chat', ...options });
			chat.messages.push(message);

			await fastify.chatService.saveChat(chat);

			send(reply, 200, message);
		},
	);
	fastify.post(
		`${basePath}/chat/:chatId/regenerate`,
		{
			schema: {
				params: Type.Object({ chatId: Type.String() }),
				body: Type.Object({
					text: Type.String(), // This is the prompt text to use for regeneration
					llmId: Type.String(),
					historyTruncateIndex: Type.Number(), // Client sends (userMessagePromptIndex + 1). This is the count of messages to retain from original chat.
				}),
			},
		},
		async (req, reply) => {
			const { chatId } = req.params;
			const { text: promptText, llmId, historyTruncateIndex } = req.body as { text: string; llmId: string; historyTruncateIndex: number };
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
			if (!llm.isConfigured()) {
				return sendBadRequest(reply, `LLM ${llmId} is not configured`);
			}

			// Validate historyTruncateIndex
			// historyTruncateIndex is sent as (userMessagePromptIndex + 1) by client.
			// It represents the length of the message history to keep, which means messages from 0 to historyTruncateIndex - 1.
			// The message at historyTruncateIndex - 1 is the user prompt that is being regenerated.
			if (historyTruncateIndex <= 0 || historyTruncateIndex > chat.messages.length) {
				// If historyTruncateIndex is 0, it means slice(0, -1) which is not intended.
				// It should be at least 1 if we are regenerating from the very first message.
				// The promptText is the content of chat.messages[historyTruncateIndex -1]
				return sendBadRequest(reply, `Invalid historyTruncateIndex. Must be > 0 and <= ${chat.messages.length}. Received: ${historyTruncateIndex}`);
			}

			// Truncate messages to include the user prompt being regenerated from.
			// The promptText is the content of chat.messages[historyTruncateIndex - 1]
			chat.messages = chat.messages.slice(0, historyTruncateIndex - 1);

			// Add the user prompt (which might be the original or a modified one by the user, though current client sends original)
			chat.messages.push({ role: 'user', content: promptText, time: Date.now() });

			const message = await llm.generateMessage(chat.messages, { id: 'chat-regenerate' });
			chat.messages.push(message);
			chat.updatedAt = Date.now();

			await fastify.chatService.saveChat(chat);
			send(reply, 200, message); // Send back the new AI message
		},
	);
	fastify.get(
		`${basePath}/chats`,
		{
			schema: {
				params: Type.Object({
					startAfterId: Type.Optional(Type.String()),
				}),
			},
		},
		async (req, reply) => {
			const { startAfterId } = req.params;
			const chats: ChatList = await fastify.chatService.listChats(startAfterId);
			reply.sendJSON(chats);
		},
	);
	fastify.delete(
		`${basePath}/chat/:chatId`,
		{
			schema: {
				params: Type.Object({
					chatId: Type.String(),
				}),
			},
		},
		async (req, reply) => {
			const { chatId } = req.params;
			const userId = currentUser().id;
			try {
				const chat = await fastify.chatService.loadChat(chatId);
				if (chat.userId !== userId) {
					return sendBadRequest(reply, 'Unauthorized to delete this chat');
				}
				await fastify.chatService.deleteChat(chatId);
				send(reply, 200, { success: true });
			} catch (error) {
				logger.error(`Failed to delete chat ${chatId}:`, error);
				send(reply, 500, { error: 'Failed to delete chat' });
			}
		},
	);
}

/**
 * Extracts the chat message properties and attachments from the request
 * @param req
 */
async function extractMessage(req: FastifyRequest<any>): Promise<{
	llmId: string;
	userContent: UserContentExt;
	options?: GenerateOptions;
}> {
	const parts = req.parts();

	let text: string;
	let llmId: string;
	let options: GenerateOptions;
	const attachments: Array<FilePartExt | ImagePartExt> = [];

	for await (const part of parts) {
		if (part.type === 'file') {
			const file = part as MultipartFile;
			const data = await file.toBuffer();

			if (file.mimetype.startsWith('image/')) {
				attachments.push({
					type: 'image',
					filename: file.filename,
					size: data.length,
					image: data.toString('base64'),
					mimeType: file.mimetype,
				});
			} else {
				attachments.push({
					type: 'file',
					filename: file.filename,
					size: data.length,
					data: data.toString('base64'),
					mimeType: file.mimetype,
				});
			}
		} else if (part.type === 'field') {
			if (part.fieldname === 'text') {
				text = part.value as string;
			} else if (part.fieldname === 'llmId') {
				llmId = part.value as string;
			} else if (part.fieldname === 'options') {
				options = JSON.parse(part.value as string);
			}
		}
	}
	return { llmId, userContent: toUserContent(text, attachments), options };
}

/**
 * Converts a text message and attachments from the UI to the UserContentExt type stored in the database
 * @param message
 * @param attachments
 */
export function toUserContent(message: string, attachments: Array<FilePartExt | ImagePartExt>): UserContentExt {
	if (!attachments || attachments.length === 0) return message;

	const userContent: UserContentExt = [];

	for (const attachment of attachments) {
		if (attachment.type === 'file') {
			userContent.push({
				type: 'file',
				data: attachment.data,
				mimeType: attachment.mimeType, // mimeType is required for files
				filename: attachment.filename,
				size: attachment.size,
			});
		} else if (attachment.type === 'image') {
			userContent.push({
				type: 'image',
				image: attachment.image,
				mimeType: attachment.mimeType, // mimeType is optional for images
				filename: attachment.filename,
				size: attachment.size,
			});
		} else {
			throw new Error('Invalid attachment type');
		}
	}

	userContent.push({
		type: 'text',
		text: message,
	});
	return userContent;
}
