import { randomUUID } from 'crypto';
import { MultipartFile } from '@fastify/multipart';
import { Type } from '@sinclair/typebox';
import { TextStreamPart, UserContent } from 'ai';
import { FastifyRequest } from 'fastify';
import { Chat, ChatList } from '#chat/chatTypes';
import { send, sendBadRequest } from '#fastify/index';
import { FilePartExt, GenerateOptions, ImagePartExt, LLM, LlmMessage, UserContentExt } from '#llm/llm';
import { getLLM } from '#llm/llmFactory';
import { summaryLLM } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { currentUser } from '#user/userService/userContext';
import { AppFastifyInstance } from '../../applicationTypes';

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
			if (chat.userId !== userId) {
				return sendBadRequest(reply, 'Unauthorized to view this chat');
			}
			send(reply, 200, chat);
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
		);

		// Add the user message to the chat
		chat.messages.push({ role: 'user', content: userContent, time: Date.now() });

		// Set the title if available
		if (titlePromise) chat.title = await titlePromise;

		// Save the chat with just the user message
		chat = await fastify.chatService.saveChat(chat);

		// Return the chat without generating the AI response
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
			send(reply, 200, chats);
		},
	);
	fastify.post(
		`${basePath}/chat/:chatId/stream`,
		{
			schema: {
				params: Type.Object({
					chatId: Type.String(),
				}),
				body: Type.Object({
					userContent: Type.Any(),
					llmId: Type.String(),
					options: Type.Optional(Type.Any())
				})
			},
		},
		async (req, reply) => {
			const { chatId } = req.params;
			const { llmId, userContent, options } = req.body;
			const userId = currentUser().id;

			try {
				// Load the chat
				const chat = await fastify.chatService.loadChat(chatId);
				
				// Check authorization
				if (chat.userId !== userId) {
					return sendBadRequest(reply, 'Unauthorized to access this chat');
				}

				// Get the LLM
				let llm: LLM;
				try {
					llm = getLLM(llmId);
				} catch (e) {
					return sendBadRequest(reply, `No LLM for ${llmId}`);
				}
				
				// Check if LLM is configured
				if (!llm.isConfigured()) {
					return sendBadRequest(reply, `LLM ${llm.getId()} is not configured`);
				}

				// Add the user message to the chat
				const userMessage: LlmMessage = { 
					role: 'user', 
					content: userContent, 
					time: Date.now() 
				};
				chat.messages.push(userMessage);
				
				// Save the chat with the new user message
				await fastify.chatService.saveChat(chat);

				// Set up SSE headers
				reply.raw.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					'Connection': 'keep-alive',
				});

				// Variable to accumulate the full response
				let accumulatedText = '';

				// Stream the response
				try {
					const generationStats = await llm.streamText(
						chat.messages,
						(chunk: TextStreamPart<any>) => {
							if (chunk.type === 'text-delta') {
								const textChunk = chunk.textDelta;
								accumulatedText += textChunk;
								// Send chunk to client
								reply.raw.write(`data: ${JSON.stringify({ type: 'chunk', text: textChunk })}\n\n`);
							}
						},
						{ id: `chat-${chatId}`, ...options }
					);

					// Create and save the assistant message
					const assistantMessage: LlmMessage = {
						role: 'assistant',
						content: accumulatedText,
						stats: generationStats,
						time: Date.now(),
					};
					chat.messages.push(assistantMessage);
					await fastify.chatService.saveChat(chat);

					// Send completion event
					reply.raw.write(`data: ${JSON.stringify({ type: 'complete', stats: generationStats })}\n\n`);
					reply.raw.end();

				} catch (error) {
					logger.error({ err: error, chatId }, `Error during LLM stream for chat ${chatId}`);
					// Send error event if possible
					if (!reply.raw.writableEnded) {
						try {
							reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: 'LLM stream failed' })}\n\n`);
						} catch (writeError) {
							logger.error({ err: writeError }, 'Failed to write error event to SSE stream');
						} finally {
							reply.raw.end();
						}
					}
				}
			} catch (error) {
				logger.error({ err: error, chatId }, `Error setting up stream for chat ${chatId}`);
				// If headers haven't been sent yet, send a regular error response
				if (!reply.sent) {
					send(reply, 500, { error: 'Failed to set up message stream' });
				}
			}
		}
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
	userContent: UserContent;
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
export function toUserContent(message: string, attachments: Array<FilePartExt | ImagePartExt>): UserContent {
	if (!attachments) return message;

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
