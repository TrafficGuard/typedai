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

export async function createChatRoute(fastify: AppFastifyInstance): Promise<void> {
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

		// Streaming branch for creating a new chat
		const wantsStream =
			(typeof req.headers.accept === 'string' && req.headers.accept.includes('text/event-stream')) || ((req as any).query && (req as any).query.stream === '1');
		if (wantsStream) {
			// Optional autoReformat (reuse existing logic)
			if (autoReformat) {
				const originalText = contentText(currentUserContent);
				if (originalText && originalText.trim() !== '') {
					const formattingPrompt = getMarkdownFormatPrompt(originalText);
					const formattingLlm = defaultLLMs().medium;
					try {
						logger.info({ chatId: chat.id, llmId: formattingLlm.getId() }, 'Auto-reformat for new chat (stream).');
						const formattedText = await formattingLlm.generateText(formattingPrompt, { id: 'chat-auto-format' });
						if (typeof currentUserContent === 'string') currentUserContent = formattedText;
						else if (Array.isArray(currentUserContent)) {
							const textPartIndex = currentUserContent.findIndex((p) => p.type === 'text');
							if (textPartIndex !== -1 && currentUserContent[textPartIndex]?.type === 'text') {
								const newParts = [...currentUserContent];
								newParts[textPartIndex] = { ...(newParts[textPartIndex] as TextPartExt), text: formattedText };
								currentUserContent = newParts;
							} else {
								const newTextPart: TextPartExt = { type: 'text', text: formattedText };
								currentUserContent = [newTextPart, ...currentUserContent];
							}
						}
					} catch (formatError) {
						logger.error({ err: formatError, chatId: chat.id }, 'Failed auto-reformat (stream). Proceeding with original.');
					}
				}
			}

			const { serviceTier, ...restOfOptions } = options ?? {};
			const llmOptions: any = restOfOptions || {};
			if (serviceTier && serviceTier !== 'default') {
				llmOptions.providerOptions = {
					...(llmOptions.providerOptions ?? {}),
					openai: { ...(llmOptions.providerOptions?.openai ?? {}), serviceTier },
				};
			}

			// Push user message and save immediately to allocate ID
			chat.messages.push({ role: 'user', content: currentUserContent, time: Date.now() });
			const titleLLM = summaryLLM().isConfigured() ? summaryLLM() : llmInstance;
			const textForTitle = contentText(currentUserContent);
			const titlePromise: Promise<string> | undefined = titleLLM.generateText(
				`<message>\n${textForTitle}\n</message>\n\n\nThe above message is the first message in a new chat conversation. Your task is to create a short title in a few words for the conversation. Respond only with the title, nothing else.`,
				{ id: 'Chat title' },
			);
			chat.title = await titlePromise;

			const saved = await fastify.chatService.saveChat(chat);

			// Setup CORS + SSE headers using raw since we stream via reply.raw
			const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
			const uiOrigin = requestOrigin ?? (process.env.UI_URL ? new URL(process.env.UI_URL).origin : undefined);
			reply.hijack();
			reply.raw.writeHead(200, {
				...(uiOrigin
					? {
							'Access-Control-Allow-Origin': uiOrigin,
							'Access-Control-Allow-Credentials': 'true',
							Vary: 'Origin',
						}
					: {}),
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
				'X-Accel-Buffering': 'no',
			});

			const sse = (data: any) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

			// Tell client the chat was created so it can navigate
			sse({ type: 'chat-created', id: saved.id });

			let aggregatedText = '';
			let finished = false;
			reply.raw.on('close', async () => {
				try {
					if (!finished && aggregatedText && aggregatedText.length > 0) {
						const partialMsg: LlmMessage = { role: 'assistant', content: aggregatedText };
						chat.messages.push(partialMsg);
						await fastify.chatService.saveChat(chat);
						logger.info({ chatId: chat.id }, 'Saved partial assistant message for new chat on disconnect.');
					}
				} catch (e) {
					logger.error({ err: e, chatId: chat.id }, 'Error saving partial for new chat on disconnect.');
				}
			});

			try {
				const stats = await llmInstance.streamText(
					chat.messages,
					(part) => {
						if (part.type === 'text-delta') {
							const t = (part as any).text || '';
							aggregatedText += t;
							sse({ type: 'text-delta', text: t });
						} else if (part.type === 'reasoning-delta') {
							sse({ type: 'reasoning-delta', text: (part as any).text || '' });
						} else if (part.type === 'source') {
							sse(part);
						} else if (part.type === 'tool-call' || part.type === 'tool-input-start' || part.type === 'tool-input-delta' || part.type === 'tool-result') {
							sse({ ...part });
						}
					},
					llmOptions,
				);

				// Append assistant message and finalize title
				const responseMessage: LlmMessage = { role: 'assistant', content: aggregatedText, stats };
				chat.messages.push(responseMessage);
				if (titlePromise) chat.title = await titlePromise.catch(() => chat.title);
				await fastify.chatService.saveChat(chat);
				finished = true;
				sse({ type: 'finish', id: chat.id, title: chat.title });
				reply.raw.end();
				return;
			} catch (err) {
				logger.error({ err }, 'Streaming createChat failed');
				sse({ type: 'error', message: (err as Error)?.message ?? 'Streaming error' });
				reply.raw.end();
				return;
			}
		}

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

		reply.sendJSON(savedChat);
	});
}
