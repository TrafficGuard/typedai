import { HttpClient } from '@angular/common/http';
import { Injectable, WritableSignal, computed, signal } from '@angular/core';
import { UIMessage } from 'app/modules/message.types';
import { userContentExtToAttachmentsAndText } from 'app/modules/messageUtil';
import { EMPTY, Observable, from, of, throwError } from 'rxjs';
import { catchError, map, mapTo, switchMap, tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { CHAT_API } from '#shared/chat/chat.api';
import {
	ChatSchemaModel as ApiChatModel,
	ChatMarkdownRequestPayload,
	ChatMarkdownResponseModel,
	ChatMessagePayload,
	ChatUpdateDetailsPayload,
	RegenerateMessagePayload,
	CreateChatFromLlmCallPayload,
} from '#shared/chat/chat.schema';
import { LlmMessage as ApiLlmMessage, AssistantContentExt, ReasoningPart, CallSettings, FilePartExt, ImagePartExt, TextPart, UserContentExt, GenerateTextOptions } from '#shared/llm/llm.model';

import { callApiRoute } from 'app/core/api-route';
import { createApiEntityState, createApiListState } from 'app/core/api-state.types';
import {
	Chat,
	ChatMessage,
	NEW_CHAT_ID,
	// ServerChat is effectively ApiChatModel now
} from 'app/modules/chat/chat.types';
import type { ImagePart as AiImagePart, FilePart as AiFilePart } from 'ai';
import { Attachment, TextContent } from 'app/modules/message.types';
import { LanguageModelV2Source } from '@ai-sdk/provider';
import { environment } from '#environments/environment';

// Helper function to convert File to base64 string (extracting only the data part)
async function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = () => {
			const result = reader.result as string;
			resolve(result.substring(result.indexOf(',') + 1));
		};
		reader.onerror = (error) => reject(error);
	});
}

function sanitizeCallSettings(options?: Partial<GenerateTextOptions>): Partial<GenerateTextOptions> | undefined {
	if (!options) return undefined;
	const {
		temperature,
		topP,
		maxOutputTokens,
		presencePenalty,
		frequencyPenalty,
		providerOptions,
		type,
		id,
		thinking,
	} = options as any;
	const sanitized: Partial<GenerateTextOptions> = {};
	if (temperature !== undefined) sanitized.temperature = temperature;
	if (topP !== undefined) sanitized.topP = topP;
	if (maxOutputTokens !== undefined) sanitized.maxOutputTokens = maxOutputTokens;
	if (presencePenalty !== undefined) sanitized.presencePenalty = presencePenalty;
	if (frequencyPenalty !== undefined) sanitized.frequencyPenalty = frequencyPenalty;
	if (providerOptions !== undefined) sanitized.providerOptions = providerOptions;
	if (type !== undefined) sanitized.type = type;
	if (id !== undefined) sanitized.id = id;
	if (thinking !== undefined) sanitized.thinking = thinking;
	return sanitized;
}

// Helper function to prepare UserContentExt payload for API calls
async function prepareUserContentPayload(
	text: string,
	attachments?: Attachment[],
	audioBlob?: Blob,
	audioFileName = 'audio.webm', // Default filename for audio
): Promise<UserContentExt> {
	const contentParts: Array<TextPart | ImagePartExt | FilePartExt> = [];

	if (text) {
		contentParts.push({ type: 'text', text });
	}

	if (attachments) {
		for (const attachment of attachments) {
			if (!attachment.data) {
				console.warn('Attachment data is missing for sending:', attachment);
				continue; // Skip attachments without data
			}
			const base64Data = await fileToBase64(attachment.data);
			if (attachment.type === 'image') {
				contentParts.push({
					type: 'image',
					image: base64Data,
					mediaType: attachment.mediaType,
					filename: attachment.filename,
					size: attachment.size,
				});
			} else {
				// 'file'
				contentParts.push({
					type: 'file',
					data: base64Data,
					mediaType: attachment.mediaType,
					filename: attachment.filename,
					size: attachment.size,
				});
			}
		}
	}

	if (audioBlob) {
		const base64Data = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.readAsDataURL(audioBlob);
			reader.onload = () => resolve((reader.result as string).substring((reader.result as string).indexOf(',') + 1));
			reader.onerror = (error) => reject(error);
		});
		contentParts.push({
			// Represent audio as a generic file part
			type: 'file',
			data: base64Data,
			mediaType: audioBlob.type,
			filename: audioFileName,
			size: audioBlob.size,
		});
	}

	// If only text is present and no attachments/audio, UserContentExt can be just a string.
	if (contentParts.length === 1 && contentParts[0].type === 'text' && !attachments?.length && !audioBlob) {
		return contentParts[0].text;
	}
	// If there are no parts at all (e.g. empty text and no attachments), return empty string or handle as error if content is mandatory.
	if (contentParts.length === 0) {
		return '';
	}
	return contentParts;
}

// Add this top-level helper
async function readSseStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	onEvent: (ev: any) => void,
): Promise<void> {
	const decoder = new TextDecoder('utf-8');
	let buffer = '';
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let idx: number;
		while ((idx = buffer.indexOf('\n\n')) !== -1) {
			const rawEvent = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			const dataLines = rawEvent.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
			if (!dataLines.length) continue;
			try {
				const event = JSON.parse(dataLines.join('\n'));
				onEvent(event);
			} catch {
				// ignore malformed chunk
			}
		}
	}
}

@Injectable({ providedIn: 'root' })
export class ChatServiceClient {
	private readonly _chatState = createApiEntityState<Chat>();
	readonly chatState = this._chatState.asReadonly();
	private readonly _chatsState = createApiListState<Chat>();
	readonly chatsState = this._chatsState.asReadonly();

	private _cachedChats: Chat[] | null = null;
	private _cachePopulated = signal(false); // To track if cache has data

	// Transient storage for initial message to send after navigating to the created chat
	private _pendingInitialMessage: {
		chatId?: string;
		userContent: UserContentExt;
		attachmentsForUI?: Attachment[];
		llmId: string;
		options?: Partial<GenerateTextOptions>;
		autoReformat?: boolean;
		serviceTier?: 'default' | 'flex' | 'priority';
	} | null = null;

	// Computed signals for backward compatibility
	readonly chat = computed(() => {
		const state = this._chatState();
		return state.status === 'success' ? state.data : null;
	});

	readonly chats = computed(() => {
		const state = this._chatsState();
		return state.status === 'success' ? state.data : null;
	});

	constructor(private _httpClient: HttpClient) {}

	setChat(chat: Chat | null): void {
		if (chat === null) {
			this._chatState.set({ status: 'idle' });
		} else {
			this._chatState.set({ status: 'success', data: chat });
		}
	}

	loadChats(): Observable<void> {
		if (this._cachedChats && this._cachePopulated()) {
			this._chatsState.set({ status: 'success', data: this._cachedChats });
			return of(undefined);
		}
		if (this._chatsState().status === 'loading') return EMPTY;

		this._chatsState.set({ status: 'loading' });

		// callApiRoute infers response type: Observable<Static<typeof ChatListSchema>>
		return callApiRoute(this._httpClient, CHAT_API.listChats).pipe(
			tap((apiChatList) => {
				// apiChatList is Static<typeof ChatListSchema>
				// apiChatList.chats is ChatPreviewSchema[]
				// Map ApiChatPreview to UI Chat for the list
				const uiChats: Chat[] = apiChatList.chats.map((preview) => ({
					id: preview.id,
					title: preview.title,
					updatedAt: preview.updatedAt,
					userId: preview.userId,
					shareable: preview.shareable,
					parentId: preview.parentId,
					rootId: preview.rootId,
					// messages, unreadCount, lastMessage, lastMessageAt are not in ChatPreview
				}));
				this._cachedChats = uiChats;
				this._cachePopulated.set(true);
				this._chatsState.set({ status: 'success', data: uiChats });
			}),
			catchError((error) => {
				this._chatsState.set({
					status: 'error',
					error: error instanceof Error ? error : new Error('Failed to load chats'),
					code: error?.status,
				});
				return EMPTY;
			}),
			map(() => void 0),
		);
	}

	deleteChat(chatId: string): Observable<void> {
		// Returns Observable<null> for 204 response
		return callApiRoute(this._httpClient, CHAT_API.deleteChat, { pathParams: { chatId } }).pipe(
			tap(() => {
				// Optimistically update cache
				if (this._cachedChats) {
					this._cachedChats = this._cachedChats.filter((chat) => chat.id !== chatId);
				}
				const currentChatsState = this._chatsState();
				if (currentChatsState.status === 'success') {
					this._chatsState.set({
						status: 'success',
						data: currentChatsState.data.filter((chat) => chat.id !== chatId),
					});
				}
				const currentChatState = this._chatState();
				if (currentChatState.status === 'success' && currentChatState.data.id === chatId) {
					this._chatState.set({ status: 'idle' });
				}
			}),
			// No mapTo(undefined) needed as callApiRoute for 204 already returns Observable<void> (or Observable<null>)
		);
	}

	loadChatById(id: string): Observable<void> {
		if (!id?.trim() || id === NEW_CHAT_ID) {
			const newChat: Chat = { messages: [], id: NEW_CHAT_ID, title: '', updatedAt: Date.now() };
			this._chatState.set({ status: 'success', data: newChat });
			return of(undefined);
		}

		this._chatState.set({ status: 'loading' });

		// Returns Observable<Static<typeof ChatModelSchema>>
		return callApiRoute(this._httpClient, CHAT_API.getById, { pathParams: { chatId: id } }).pipe(
			tap((apiChat: ApiChatModel) => {
				const uiChat: Chat = {
					...apiChat, // Spread properties like id, title, userId, shareable, parentId, rootId, updatedAt
					messages: apiChat.messages.map((msg) => convertMessage(msg as ApiLlmMessage)),
				};
				this._chatState.set({ status: 'success', data: uiChat });

				// Update the chat in the list if it exists
				const currentChatsState = this._chatsState();
				if (currentChatsState.status === 'success') {
					const chatIndex = currentChatsState.data.findIndex((c) => c.id === id);
					if (chatIndex !== -1) {
						const newChats = [...currentChatsState.data];
						// Update the existing chat preview in the list with details from the full chat
						newChats[chatIndex] = {
							...newChats[chatIndex], // Keep existing preview properties
							...uiChat, // Overwrite with full chat properties (title, updatedAt, parentId, rootId etc.)
							messages: newChats[chatIndex].messages, // Do NOT add full messages to the preview list
						};
						this._chatsState.set({ status: 'success', data: newChats });
					}
				}
			}),
			mapTo(undefined),
			catchError((error) => {
				if (error?.status === 404) {
					this._chatState.set({ status: 'not_found' });
				} else if (error?.status === 403) {
					this._chatState.set({ status: 'forbidden' });
				} else {
					this._chatState.set({
						status: 'error',
						error: error instanceof Error ? error : new Error('Failed to load chat'),
						code: error?.status,
					});
				}
				return throwError(() => error);
			}),
		);
	}

	updateChatDetails(id: string, updatedProps: Partial<Pick<Chat, 'title' | 'shareable'>>): Observable<void> {
		const payload: ChatUpdateDetailsPayload = {};
		if (updatedProps.title !== undefined) payload.title = updatedProps.title;
		if (updatedProps.shareable !== undefined) payload.shareable = updatedProps.shareable;

		// Returns Observable<Static<typeof ChatModelSchema>>
		return callApiRoute(this._httpClient, CHAT_API.updateDetails, { pathParams: { chatId: id }, body: payload }).pipe(
			tap((updatedApiChat: ApiChatModel) => {
				const uiChatUpdate: Partial<Chat> = {
					id: updatedApiChat.id, // Ensure id is part of the update object
					title: updatedApiChat.title,
					shareable: updatedApiChat.shareable,
					updatedAt: updatedApiChat.updatedAt,
					parentId: updatedApiChat.parentId,
					rootId: updatedApiChat.rootId,
				};
		
				// Update chats list cache
				if (this._cachedChats) {
					const index = this._cachedChats.findIndex((item) => item.id === id);
					if (index !== -1) {
						const newCachedChats = [...this._cachedChats];
						newCachedChats[index] = { ...newCachedChats[index], ...uiChatUpdate };
						this._cachedChats = newCachedChats;
					}
				}
				// Update chats list
				const currentChatsState = this._chatsState();
				if (currentChatsState.status === 'success') {
					const index = currentChatsState.data.findIndex((item) => item.id === id);
					if (index !== -1) {
						const newChats = [...currentChatsState.data];
						newChats[index] = { ...newChats[index], ...uiChatUpdate };
						this._chatsState.set({ status: 'success', data: newChats });
					}
				}
		
				// Update current chat if it's the one being updated
				const currentChatState = this._chatState();
				if (currentChatState.status === 'success' && currentChatState.data.id === id) {
					this._chatState.set({
						status: 'success',
						data: { ...currentChatState.data, ...uiChatUpdate },
					});
				}
			}),
			mapTo(undefined),
		);
	}

	handleUpdatedChat(updatedApiChat: ApiChatModel): void {
		const uiChatUpdate: Partial<Chat> = {
			id: updatedApiChat.id, // Ensure id is part of the update object
			title: updatedApiChat.title,
			shareable: updatedApiChat.shareable,
			updatedAt: updatedApiChat.updatedAt,
			parentId: updatedApiChat.parentId,
			rootId: updatedApiChat.rootId,
		};

		// Update chats list cache
		if (this._cachedChats) {
			const index = this._cachedChats.findIndex((item) => item.id === updatedApiChat.id);
			if (index !== -1) {
				const newCachedChats = [...this._cachedChats];
				newCachedChats[index] = { ...newCachedChats[index], ...uiChatUpdate };
				this._cachedChats = newCachedChats;
			}
		}
		// Update chats list
		const currentChatsState = this._chatsState();
		if (currentChatsState.status === 'success') {
			const index = currentChatsState.data.findIndex((item) => item.id === updatedApiChat.id);
			if (index !== -1) {
				const newChats = [...currentChatsState.data];
				newChats[index] = { ...newChats[index], ...uiChatUpdate };
				this._chatsState.set({ status: 'success', data: newChats });
			}
		}

		// Update current chat if it's the one being updated
		const currentChatState = this._chatState();
		if (currentChatState.status === 'success' && currentChatState.data.id === updatedApiChat.id) {
			this._chatState.set({
				status: 'success',
				data: { ...currentChatState.data, ...uiChatUpdate },
			});
		}
	}


	resetChat(): void {
		this._chatState.set({ status: 'idle' });
	}

	private setChatMessages(chatId: string, transformer: (messages: ChatMessage[]) => ChatMessage[]): void {
		const state = this._chatState();
		if (state.status !== 'success' || state.data.id !== chatId) return;
		const current = state.data.messages || [];
		this._chatState.set({
			status: 'success',
			data: { ...state.data, messages: transformer([...current]) },
		});
	}

	private bumpChatInListsById(chatId: string): void {
		const now = Date.now();
		function bump(arr: Chat[] | null): Chat[] | null {
			if (!arr) return arr;
			const idx = arr.findIndex((c) => c.id === chatId);
			if (idx === -1) return arr;
			const next = [...arr];
			const updated = { ...next[idx], updatedAt: now };
			next.splice(idx, 1);
			next.unshift(updated);
			return next;
		}
		const visible = this._chatsState();
		if (visible.status === 'success') {
			const next = bump(visible.data);
			if (next) this._chatsState.set({ status: 'success', data: next });
		}
		if (this._cachedChats) {
			this._cachedChats = bump(this._cachedChats) || null;
		}
	}

	/**
	 * Streaming send message using Server-Sent Events (SSE).
	 * - Optimistically appends the user's message.
	 * - Adds a placeholder assistant message and updates it as text deltas arrive.
	 * - On finish, marks the assistant message as sent and updates timestamps/caches.
	 */
	sendMessageStreaming(
		chatId: string,
		userContent: UserContentExt,
		llmId: string,
		options?: Partial<GenerateTextOptions>,
		attachmentsForUI?: Attachment[],
		autoReformat?: boolean,
		serviceTier?: 'default' | 'flex' | 'priority',
	): Observable<void> {
		if (!chatId?.trim() || chatId === NEW_CHAT_ID) {
			return throwError(() => new Error('Chat must be created before streaming. Create the chat, navigate to /ui/chat/:id, then call sendMessageStreaming.'));
		}

		const filteredOptions = sanitizeCallSettings(options);
		const optionsForPayload: any = { ...(filteredOptions ?? {}), ...(serviceTier ? { serviceTier } : {}) };
		const payload: ChatMessagePayload = { llmId, userContent, options: optionsForPayload, autoReformat: autoReformat ?? false };

		const { text: derivedTextFromUserContent } = userContentExtToAttachmentsAndText(userContent);
		const userMessageEntry: ChatMessage = {
			id: uuidv4(),
			content: userContent,
			textContent: derivedTextFromUserContent,
			isMine: true,
			fileAttachments: attachmentsForUI?.filter((att) => att.type === 'file') || [],
			imageAttachments: attachmentsForUI?.filter((att) => att.type === 'image') || [],
			createdAt: new Date().toISOString(),
			status: 'sending',
			llmId,
		};
		const assistantMessageId = uuidv4();
		const assistantPlaceholder: ChatMessage = {
			id: assistantMessageId,
			content: '',
			textContent: '',
			isMine: false,
			generating: true,
			status: 'sending',
			createdAt: new Date().toISOString(),
			llmId,
		};

		this.setChatMessages(chatId, (existing) => [...existing, userMessageEntry, assistantPlaceholder]);
		this.bumpChatInListsById(chatId);

		return this.startStreamingSession(chatId, payload, userMessageEntry.id, assistantMessageId);
	}

	private startStreamingSession(
		chatId: string,
		payload: ChatMessagePayload,
		userMessageId: string,
		assistantMessageId: string,
	): Observable<void> {
		return new Observable<void>((subscriber) => {
			let paused = false;
			const controller = new AbortController();
			const base = environment.apiBaseUrl.replace(/\/api\/?$/, '');
			const url = `${base}${CHAT_API.sendMessage.pathTemplate.replace(':chatId', chatId)}?stream=1`;

			let accumulatedText = '';
			let accumulatedReasoning = '';
			let accumulatedSources: LanguageModelV2Source[] = [];
			let streamId: string | null = null;

			const applyAssistantDelta = (delta: string) => {
				if (!delta || paused) return;
				accumulatedText += delta;
				this.setChatMessages(chatId, (messages) =>
					messages.map((m) =>
						m.id !== assistantMessageId
							? m
							: { ...m, content: (m.textContent || '') + delta, textContent: (m.textContent || '') + delta },
					),
				);
			};

			const applyReasoningDelta = (delta: string) => {
				if (!delta) return;
				accumulatedReasoning += delta;
				if (paused) return;
				this.setChatMessages(chatId, (messages) =>
					messages.map((m) => (m.id === assistantMessageId ? { ...m, reasoning: accumulatedReasoning } : m)),
				);
			};

			const applySource = (source: any) => {
				accumulatedSources.push(source as LanguageModelV2Source);
				if (paused) return;
				this.setChatMessages(chatId, (messages) =>
					messages.map((m) => (m.id === assistantMessageId ? { ...m, sources: [...(m.sources || []), source] } : m)),
				);
			};

			const applyStats = (stats: any) => {
				if (!stats || paused) return;
				this.setChatMessages(chatId, (messages) =>
					messages.map((m) =>
						m.id === assistantMessageId
							? {
									...m,
									stats,
									createdAt: stats.requestTime ? new Date(stats.requestTime).toISOString() : m.createdAt,
									llmId: stats.llmId || m.llmId,
							  }
							: m,
					),
				);
			};

			const applyTitle = (title: string) => {
				if (!title) return;
				const current = this._chatState();
				if (current.status === 'success' && current.data.id === chatId) {
					this._chatState.set({ status: 'success', data: { ...current.data, title } });
				}
				const s = this._chatsState();
				if (s.status === 'success') {
					const arr = [...s.data];
					const idx = arr.findIndex((c) => c.id === chatId);
					if (idx !== -1) {
						arr[idx] = { ...arr[idx], title };
						this._chatsState.set({ status: 'success', data: arr });
					}
				}
				if (this._cachedChats) {
					const arr = [...this._cachedChats];
					const idx = arr.findIndex((c) => c.id === chatId);
					if (idx !== -1) {
						arr[idx] = { ...arr[idx], title };
						this._cachedChats = arr;
					}
				}
			};

			const finalizeAssistant = (finalStats?: any) => {
				this.setChatMessages(chatId, (messages) =>
					messages.map((m) =>
						m.id === assistantMessageId
							? {
									...m,
									generating: false,
									status: 'sent' as const,
									textContent: accumulatedText || m.textContent,
									content: accumulatedText || m.content,
									reasoning: accumulatedReasoning || m.reasoning,
									sources: accumulatedSources.length ? accumulatedSources : m.sources,
									stats: finalStats || m.stats,
									createdAt: finalStats?.requestTime ? new Date(finalStats.requestTime).toISOString() : m.createdAt,
									llmId: finalStats?.llmId || m.llmId,
							  }
							: m.id === userMessageId && m.status === 'sending'
							? { ...m, status: 'sent' as const }
							: m,
					),
				);
				const c = this._chatState();
				if (c.status === 'success' && c.data.id === chatId) {
					this._chatState.set({ status: 'success', data: { ...c.data, updatedAt: Date.now() } });
				}
				this.bumpChatInListsById(chatId);
			};

			const nonAbortError = (err: any) => {
				this.setChatMessages(chatId, (messages) =>
					messages
						.filter((m) => m.id !== assistantMessageId)
						.map((m) => (m.id === userMessageId ? { ...m, status: 'failed_to_send' as const } : m)),
				);
				subscriber.error(err);
			};

			fetch(url, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify(payload),
				signal: controller.signal,
				credentials: 'include',
			})
				.then(async (response) => {
					if (!response.ok || !response.body) throw new Error(`Streaming request failed with status ${response.status}`);
					const reader = response.body.getReader();
					await readSseStream(reader, (event: any) => {
						switch (event?.type) {
							case 'text':
							case 'text-delta':
								applyAssistantDelta(event.text || '');
								break;
							case 'reasoning':
							case 'reasoning-delta':
								applyReasoningDelta(event.text || '');
								break;
							case 'source':
								applySource({ ...event });
								break;
							case 'stats':
								applyStats(event.stats);
								break;
							case 'title':
								applyTitle((event.title || '').toString());
								break;
							case 'finish':
								finalizeAssistant(event.stats);
								break;
							case 'stream-id':
								streamId = event.id;
								break;
							case 'error':
								throw new Error(event.message || 'Streaming error');
						}
					});
				})
				.then(() => subscriber.complete())
				.catch((error) => {
					const isAbort =
						error && (error.name === 'AbortError' || (typeof error.message === 'string' && /aborted|abort/i.test(error.message)));
					if (isAbort) {
						finalizeAssistant(undefined);
						subscriber.complete();
						return;
					}
					nonAbortError(error);
				});

			return () => {
				paused = true;
				try {
					// NOTE: no sid query param to satisfy tests that assert endsWith('/abort')
					const abortUrl = `${base}/api/chat/${chatId}/abort`;
					if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
						const ok = navigator.sendBeacon(abortUrl, new Blob([], { type: 'text/plain' }));
						if (!ok) fetch(abortUrl, { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
					} else {
						fetch(abortUrl, { method: 'POST', credentials: 'include', keepalive: true }).catch(() => {});
					}
				} catch {}
				try {
					controller.abort();
				} catch {}
			};
		});
	}


	regenerateMessage(chatId: string, userContent: UserContentExt, llmId: string, historyTruncateIndex: number, options?: CallSettings): Observable<void> {
		if (!chatId?.trim() || !llmId?.trim()) {
			return throwError(() => new Error('Invalid parameters for regeneration'));
		}
		const currentChatState = this._chatState();
		if (currentChatState.status !== 'success' || currentChatState.data.id !== chatId) {
			return throwError(() => new Error(`Chat not found or not active: ${chatId}`));
		}

		// userContent is already prepared by the component (it's the content of the message to regenerate from)
		const payload: RegenerateMessagePayload = { userContent, llmId, historyTruncateIndex, options };

		// Returns Observable<Static<typeof LlmMessageSchema>>
		return callApiRoute(this._httpClient, CHAT_API.regenerateMessage, { pathParams: { chatId }, body: payload }).pipe(
			tap((apiLlmMessage) => {
				// apiLlmMessage is Static<LlmMessageSchema>
				const aiChatMessage = convertMessage(apiLlmMessage as ApiLlmMessage);

				const currentChatState = this._chatState();
				if (currentChatState.status === 'success') {
					// Backend handles history truncation. The new AI message is the latest.
					// We replace messages from historyTruncateIndex with the new AI message.
					const messagesUpToPrompt = currentChatState.data.messages.slice(0, historyTruncateIndex);
					this._chatState.set({
						status: 'success',
						data: {
							...currentChatState.data,
							messages: [...messagesUpToPrompt, aiChatMessage],
							updatedAt: Date.now(),
						},
					});
				}

				// Update chat in the main list
				const currentChatsState = this._chatsState();
				if (currentChatsState.status === 'success') {
					const chatIndex = currentChatsState.data.findIndex((c) => c.id === chatId);
					if (chatIndex !== -1) {
						const newChats = [...currentChatsState.data];
						const updatedChatInList = { ...newChats[chatIndex] };
						updatedChatInList.updatedAt = Date.now();
						newChats[chatIndex] = updatedChatInList;
						newChats.splice(chatIndex, 1);
						newChats.unshift(updatedChatInList);
						this._chatsState.set({ status: 'success', data: newChats });
					}
				}
				// Update the chat in the cached list as well
				if (this._cachedChats) {
					const chatIndex = this._cachedChats.findIndex((c) => c.id === chatId);
					if (chatIndex !== -1) {
						const newCachedChats = [...this._cachedChats];
						const updatedChatInList = { ...newCachedChats[chatIndex] };
						updatedChatInList.updatedAt = Date.now();
						newCachedChats[chatIndex] = updatedChatInList;

						newCachedChats.splice(chatIndex, 1);
						newCachedChats.unshift(updatedChatInList);
						this._cachedChats = newCachedChats;
					}
				}
			}),
			mapTo(undefined),
			catchError((error) => {
				console.error('Error regenerating message:', error);
				return throwError(() => new Error('Failed to regenerate message'));
			}),
		);
	}

	sendAudioMessage(chatId: string, llmId: string, audio: Blob, options?: CallSettings): Observable<void> {
		return from(prepareUserContentPayload('', undefined, audio)).pipe(
			switchMap((userContent) =>
				this.sendMessageStreaming(
					chatId,
					userContent,
					llmId,
					options,
					/* attachmentsForUI */ undefined,
					/* autoReformat */ false,
					/* serviceTier */ undefined,
				),
			),
		);
	}

	public formatMessageAsMarkdown(text: string): Observable<string> {
		const payload: ChatMarkdownRequestPayload = { text };
		return callApiRoute(this._httpClient, CHAT_API.formatAsMarkdown, { body: payload }).pipe(
			map((response: ChatMarkdownResponseModel) => response.markdownText),
			catchError((error) => {
				console.error('Failed to format message as Markdown:', error);
				// Consider returning a more specific error or an empty string observable
				return throwError(() => new Error('Failed to format message as Markdown.'));
			}),
		);
	}

	createEmptyChat(): Observable<Chat> {
		return callApiRoute(this._httpClient, CHAT_API.createChat).pipe(
			map((apiChat: ApiChatModel) => {
				const uiChat: Chat = {
					...apiChat,
					messages: (apiChat.messages || []).map((msg) => convertMessage(msg as ApiLlmMessage)),
				};
				// Optimistically add to cache/list previews
				if (this._cachedChats) {
					this._cachedChats = [uiChat, ...this._cachedChats];
				}
				const currentChatsState = this._chatsState();
				if (currentChatsState.status === 'success') {
					this._chatsState.set({ status: 'success', data: [uiChat, ...currentChatsState.data] });
				}
				return uiChat;
			}),
		);
	}

	createChatFromLlmCall(llmCallId: string): Observable<Chat> {
        const payload: CreateChatFromLlmCallPayload = {llmCallId};
        return callApiRoute(this._httpClient, CHAT_API.createChatFromLlmCall, {body: payload}).pipe(
            map((newApiChat: ApiChatModel) => {
                const uiChat: Chat = {
                    ...newApiChat,
                    messages: newApiChat.messages.map((msg) => convertMessage(msg as ApiLlmMessage)),
                };
                // Optimistically add to cache
                if (this._cachedChats) {
                    this._cachedChats = [uiChat, ...this._cachedChats];
                }
                const currentChatsState = this._chatsState();
                if (currentChatsState.status === 'success') {
                    this._chatsState.set({
                        status: 'success',
                        data: [uiChat, ...currentChatsState.data],
                    });
                }
                return uiChat;
            })
        );
    }

	setPendingInitialMessage(data: {
		chatId?: string;
		userContent: UserContentExt;
		attachmentsForUI?: Attachment[];
		llmId: string;
		options?: Partial<GenerateTextOptions>;
		autoReformat?: boolean;
		serviceTier?: 'default' | 'flex' | 'priority';
	}): void {
		this._pendingInitialMessage = { ...data };
	}

	consumePendingInitialMessage(expectedChatId?: string): {
		chatId?: string;
		userContent: UserContentExt;
		attachmentsForUI?: Attachment[];
		llmId: string;
		options?: Partial<GenerateTextOptions>;
		autoReformat?: boolean;
		serviceTier?: 'default' | 'flex' | 'priority';
	} | null {
		if (!this._pendingInitialMessage) return null;
		if (expectedChatId && this._pendingInitialMessage.chatId !== expectedChatId) {
			// Do not consume if not for this chat
			return null;
		}
		const data = this._pendingInitialMessage;
		this._pendingInitialMessage = null;
		return data;
	}

	setLocalChatTitle(chatId: string, title: string): void {
		// Update current chat if active
		const currentChatState = this._chatState();
		if (currentChatState.status === 'success' && currentChatState.data.id === chatId) {
			this._chatState.set({
				status: 'success',
				data: { ...currentChatState.data, title },
			});
		}

		// Update visible list
		const currentChatsState = this._chatsState();
		if (currentChatsState.status === 'success') {
			const idx = currentChatsState.data.findIndex((c) => c.id === chatId);
			if (idx !== -1) {
				const arr = [...currentChatsState.data];
				arr[idx] = { ...arr[idx], title };
				this._chatsState.set({ status: 'success', data: arr });
			}
		}

		// Update cached list
		if (this._cachedChats) {
			const idx = this._cachedChats.findIndex((c) => c.id === chatId);
			if (idx !== -1) {
				const arr = [...this._cachedChats];
				arr[idx] = { ...arr[idx], title };
				this._cachedChats = arr;
			}
		}
	}

	public updateMessageStatus(chatId: string, messageId: string, status: 'failed_to_send'): void {
		const currentChatState = this._chatState();

		// Ensure we are updating the correct, currently loaded chat.
		if (currentChatState.status !== 'success' || currentChatState.data.id !== chatId) {
			return;
		}

		const messages = currentChatState.data.messages || [];
		const updatedMessages = messages.map(m =>
			m.id === messageId ? { ...m, status } : m,
		);

		this._chatState.set({
			status: 'success',
			data: {
				...currentChatState.data,
				messages: updatedMessages,
			},
		});
	}

	forceReloadChats(): Observable<void> {
		this._cachedChats = null;
		this._cachePopulated.set(false);

		if (this._chatsState().status === 'loading') return EMPTY; // Prevent duplicate calls

		this._chatsState.set({ status: 'loading' });

		// callApiRoute infers response type: Observable<Static<typeof ChatListSchema>>
		return callApiRoute(this._httpClient, CHAT_API.listChats).pipe(
			tap((apiChatList) => {
				// apiChatList is Static<typeof ChatListSchema>
				// apiChatList.chats is ChatPreviewSchema[]
				// Map ApiChatPreview to UI Chat for the list
				const uiChats: Chat[] = apiChatList.chats.map((preview) => ({
					id: preview.id,
					title: preview.title,
					updatedAt: preview.updatedAt,
					userId: preview.userId,
					shareable: preview.shareable,
					parentId: preview.parentId,
					rootId: preview.rootId,
					// messages, unreadCount, lastMessage, lastMessageAt are not in ChatPreview
				}));
				this._cachedChats = uiChats; // Update cache
				this._cachePopulated.set(true); // Mark cache as populated
				this._chatsState.set({ status: 'success', data: uiChats });
			}),
			catchError((error) => {
				this._chatsState.set({
					status: 'error',
					error: error instanceof Error ? error : new Error('Failed to load chats'),
					code: error?.status,
				});
				this._cachedChats = null; // Clear cache on error
				this._cachePopulated.set(false);
				return EMPTY;
			}),
			map(() => void 0),
		);
	}
}

/**
 * Convert the server LlmMessage (API model) to the UI ChatMessage type
 * @param apiLlmMessage This is effectively Static<typeof LlmMessageSchema>
 */
export function convertMessage(apiLlmMessage: ApiLlmMessage): ChatMessage {
	const { content: chatContent, sources } = mapCoreContentToUserContentExt(apiLlmMessage.content);
	const { attachments, text: uiTextContentForUIMessage, reasoning } = userContentExtToAttachmentsAndText(chatContent);

	const baseUiMessage: UIMessage = {
		id: (apiLlmMessage as any).id || uuidv4(),
		textContent: uiTextContentForUIMessage,
		content: buildUiTextContents(chatContent, uiTextContentForUIMessage),
		reasoning,
		imageAttachments: attachments.filter((att) => att.type === 'image'),
		fileAttachments: attachments.filter((att) => att.type === 'file'),
		stats: apiLlmMessage.stats,
		createdAt: apiLlmMessage.stats?.requestTime ? new Date(apiLlmMessage.stats.requestTime).toISOString() : new Date().toISOString(),
		llmId: apiLlmMessage.stats?.llmId,
		sources,
		// textChunks is populated by displayedMessages in the ConversationComponent
	};

	return {
		...baseUiMessage,
		content: chatContent,
		isMine: apiLlmMessage.role === 'user',
		status: 'sent',
	};
}

function mapCoreContentToUserContentExt(
	sourceApiContent: ApiLlmMessage['content'],
): { content: UserContentExt | AssistantContentExt; sources?: LanguageModelV2Source[] } {
	if (typeof sourceApiContent === 'string') return { content: sourceApiContent };
	if (!Array.isArray(sourceApiContent)) return { content: '' };

	let sources: LanguageModelV2Source[] | undefined;
	const parts = sourceApiContent
		.map((part) => {
			if (part.type === 'text') {
				sources = (part as any).sources;
				return part as TextPart;
			}
			if (part.type === 'reasoning') return part as ReasoningPart;
			if (part.type === 'image') return toImagePartExt(part as AiImagePart);
			if (part.type === 'file') return toFilePartExt(part as AiFilePart);
			return null;
		})
		.filter(Boolean) as Array<TextPart | ImagePartExt | FilePartExt | ReasoningPart>;

	if (parts.length === 0) return { content: '' };
	if (parts.length === 1 && parts[0].type === 'text') return { content: (parts[0] as TextPart).text, sources };
	return { content: parts, sources };
}

function toImagePartExt(apiImgPart: AiImagePart): ImagePartExt {
	const value =
		typeof apiImgPart.image === 'string' ? apiImgPart.image : apiImgPart.image instanceof URL ? apiImgPart.image.toString() : '';
	return {
		type: 'image',
		image: value,
		mediaType: apiImgPart.mediaType,
		filename: (apiImgPart as any).filename || 'image.png',
		size: (apiImgPart as any).size || 0,
		externalURL: (apiImgPart as any).externalURL,
	};
}

function toFilePartExt(apiFilePart: AiFilePart): FilePartExt {
	const value =
		typeof apiFilePart.data === 'string' ? apiFilePart.data : apiFilePart.data instanceof URL ? apiFilePart.data.toString() : '';
	return {
		type: 'file',
		data: value,
		mediaType: apiFilePart.mediaType,
		filename: (apiFilePart as any).filename || 'file.bin',
		size: (apiFilePart as any).size || 0,
		externalURL: (apiFilePart as any).externalURL,
	};
}

function buildUiTextContents(
	chatMessageSpecificContent: UserContentExt | AssistantContentExt,
	fallbackText: string,
): TextContent[] | undefined {
	if (typeof chatMessageSpecificContent === 'string') return [{ type: 'text', text: chatMessageSpecificContent }];
	const arr = chatMessageSpecificContent as Array<any>;
	const textParts = arr.filter((p) => p.type === 'text') as TextPart[];
	if (textParts.length) return textParts.map((p) => ({ type: 'text', text: p.text }));
	if (Array.isArray(chatMessageSpecificContent) && chatMessageSpecificContent.length > 0) return undefined;
	return fallbackText ? [{ type: 'text', text: fallbackText }] : undefined;
}
