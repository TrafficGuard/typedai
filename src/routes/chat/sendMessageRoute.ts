import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/index';
import { getLLM } from '#llm/llmFactory';
import { defaultLLMs, summaryLLM } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { Chat } from '#shared/chat/chat.model';
import { type GenerateTextOptions, type LLM, type LlmMessage, type TextPartExt, type UserContentExt, contentText } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { getMarkdownFormatPrompt } from './chatPromptUtils';

export async function sendMessageRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CHAT_API.sendMessage, async (req, reply) => {
		const { chatId } = req.params;
		const { llmId, userContent, options, autoReformat } = req.body;

		let currentUserContent: UserContentExt = userContent as UserContentExt;

		const chat: Chat = await fastify.chatService.loadChat(chatId);
		if (chat.userId !== currentUser().id) return sendBadRequest(reply, 'Unauthorized to send message to this chat');

		const isFirstMessage = chat.messages.length === 0;
		const firstMessageTextForTitle = contentText(currentUserContent);

		let llmInstance: LLM;
		try {
			llmInstance = getLLM(llmId);
		} catch (e) {
			return sendBadRequest(reply, `Cannot find LLM ${llmId}`);
		}
		if (!llmInstance.isConfigured()) return sendBadRequest(reply, `LLM ${llmInstance.getId()} is not configured`);

		// Streaming branch: honor Accept: text/event-stream or ?stream=1
		// Auto reformat if requested (same logic as below)
		if (autoReformat) {
			const originalText = contentText(currentUserContent);
			if (originalText && originalText.trim() !== '') {
				const formattingPrompt = getMarkdownFormatPrompt(originalText);
				const formattingLlm = defaultLLMs().medium;
				try {
					logger.info(
						{ chatId, llmId: formattingLlm.getId(), usingLlm: formattingLlm.getId() },
						'Attempting to auto-reformat message content for existing chat (stream).',
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
							}
						} else {
							const newTextPart: TextPartExt = { type: 'text', text: formattedText };
							currentUserContent = [newTextPart, ...currentUserContent];
						}
					}
				} catch (formatError) {
					logger.error({ err: formatError, chatId }, 'Failed to auto-reformat message content for existing chat (stream). Proceeding with original.');
				}
			}
		}

		const { serviceTier, ...restOfOptions } = options ?? {};
		const llmOptions: GenerateTextOptions = restOfOptions;
		if (serviceTier && serviceTier !== 'default') {
			llmOptions.providerOptions = {
				...(llmOptions.providerOptions ?? {}),
				openai: {
					...(llmOptions.providerOptions?.openai ?? {}),
					serviceTier: serviceTier,
				},
			};
		}

		// Push user message
		chat.messages.push({ role: 'user', content: currentUserContent, time: Date.now() });
		chat.updatedAt = Date.now(); // Update updatedAt after pushing user message

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

		const sse = (data: any) => {
			reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
		};

		// Generate chat title in parallel on first message and stream it to client
		if (isFirstMessage && (!chat.title || chat.title.trim() === '')) {
			(async () => {
				try {
					const title = await summaryLLM().generateText(
						`<message>\n${firstMessageTextForTitle}\n</message>\n\nYour task is to create a short title in a few words for the conversation. Respond only with the title, nothing else.`,
						{ id: 'chat-title' },
					);
					const trimmed = (title || '').trim();
					if (trimmed) {
						chat.title = trimmed;
						chat.updatedAt = Date.now(); // Update updatedAt when saving title
						await fastify.chatService.saveChat(chat);
						sse({ type: 'title', title: chat.title });
					}
				} catch (e) {
					logger.error({ err: e, chatId }, 'Failed to generate chat title');
				}
			})();
		}

		let aggregatedText = '';
		let finished = false;
		// Persist partial on client disconnect
		reply.raw.on('close', async () => {
			try {
				if (!finished && aggregatedText && aggregatedText.length > 0) {
					const partialMsg: LlmMessage = { role: 'assistant', content: aggregatedText };
					chat.messages.push(partialMsg);
					chat.updatedAt = Date.now(); // Update updatedAt when saving partial message
					await fastify.chatService.saveChat(chat);
					logger.info({ chatId }, 'Saved partial assistant message on client disconnect.');
				}
			} catch (e) {
				logger.error({ err: e, chatId }, 'Error saving partial message on disconnect.');
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
						// Forward whole source part
						sse(part);
					} else if (part.type === 'tool-call' || part.type === 'tool-input-start' || part.type === 'tool-input-delta' || part.type === 'tool-result') {
						sse({ ...part });
					}
				},
				llmOptions,
			);

			// Append assistant message and save chat
			const responseMessage: LlmMessage = { role: 'assistant', content: aggregatedText, stats };
			chat.messages.push(responseMessage);
			chat.updatedAt = Date.now(); // Update updatedAt when saving final message
			await fastify.chatService.saveChat(chat);
			finished = true;

			// Signal finish to client and end
			sse({ type: 'finish', stats });
			reply.raw.end();
			return;
		} catch (err) {
			logger.error({ err }, 'Streaming sendMessage failed');
			sse({ type: 'error', message: (err as Error)?.message ?? 'Streaming error' });
			reply.raw.end();
			return;
		}
	});
}
