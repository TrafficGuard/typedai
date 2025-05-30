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
} from '#shared/chat/chat.schema';
import { LlmMessage as ApiLlmMessage } from '#shared/llm/llm.model';
import { CallSettings, FilePartExt, ImagePartExt, TextPart, UserContentExt } from '#shared/llm/llm.model';

import { callApiRoute } from 'app/core/api-route';
import { createApiEntityState, createApiListState } from 'app/core/api-state.types';
import {
	Chat,
	ChatMessage,
	NEW_CHAT_ID,
	// ServerChat is effectively ApiChatModel now
} from 'app/modules/chat/chat.types';
import { Attachment, TextContent } from 'app/modules/message.types';

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
					mimeType: attachment.mimeType,
					filename: attachment.filename,
					size: attachment.size,
				});
			} else {
				// 'file'
				contentParts.push({
					type: 'file',
					data: base64Data,
					mimeType: attachment.mimeType,
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
			mimeType: audioBlob.type,
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

@Injectable({ providedIn: 'root' })
export class ChatServiceClient {
	private readonly _chatState = createApiEntityState<Chat>();
	readonly chatState = this._chatState.asReadonly();
	private readonly _chatsState = createApiListState<Chat>();
	readonly chatsState = this._chatsState.asReadonly();

	private _cachedChats: Chat[] | null = null;
	private _cachePopulated = signal(false); // To track if cache has data

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

	createChat(userContent: UserContentExt, llmId: string, options?: CallSettings, autoReformat?: boolean): Observable<Chat> {
		// userContent is already prepared by the component
		const payload: ChatMessagePayload = { llmId, userContent, options, autoReformat: autoReformat ?? false };
		// Returns Observable<Static<typeof ChatModelSchema>>
		return callApiRoute(this._httpClient, CHAT_API.createChat, { body: payload }).pipe(
			map((newApiChat: ApiChatModel) => {
				const uiChat: Chat = {
					...newApiChat, // Spread properties like id, title, userId, shareable, parentId, rootId, updatedAt
					messages: newApiChat.messages.map((msg) => convertMessage(msg as ApiLlmMessage)), // msg is Static<LlmMessageSchema>
				};
				// Optimistically update cache
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
				this._chatState.set({ status: 'success', data: uiChat });
				return uiChat;
			}),
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

	resetChat(): void {
		this._chatState.set({ status: 'idle' });
	}

	sendMessage(
		chatId: string,
		userContent: UserContentExt,
		llmId: string,
		options?: CallSettings,
		attachmentsForUI?: Attachment[],
		autoReformat?: boolean,
	): Observable<void> {
		// userContent is already prepared by the component
		const payload: ChatMessagePayload = { llmId, userContent, options, autoReformat: autoReformat ?? false };

		// Locally add user's message immediately for responsiveness
		const { text: derivedTextFromUserContent } = userContentExtToAttachmentsAndText(userContent);
		const userMessageEntry: ChatMessage = {
			id: uuidv4(), // Add unique ID for optimistic update
			content: userContent,
			textContent: derivedTextFromUserContent,
			isMine: true,
			fileAttachments: attachmentsForUI?.filter((att) => att.type === 'file') || [],
			imageAttachments: attachmentsForUI?.filter((att) => att.type === 'image') || [],
			createdAt: new Date().toISOString(),
		};

		const currentChatState = this._chatState();
		if (currentChatState.status === 'success') {
			this._chatState.set({
				status: 'success',
				data: {
					...currentChatState.data,
					messages: [...(currentChatState.data.messages || []), userMessageEntry],
				},
			});
		}

		// Returns Observable<Static<typeof LlmMessageSchema>>
		return callApiRoute(this._httpClient, CHAT_API.sendMessage, { pathParams: { chatId }, body: payload }).pipe(
			tap((apiLlmMessage) => {
				// apiLlmMessage is Static<LlmMessageSchema>
				const aiChatMessage = convertMessage(apiLlmMessage as ApiLlmMessage);

				const currentChatState = this._chatState();
				if (currentChatState.status === 'success') {
					this._chatState.set({
						status: 'success',
						data: {
							...currentChatState.data,
							messages: [...(currentChatState.data.messages || []), aiChatMessage],
							updatedAt: Date.now(),
						},
					});
				}

				// Update the chat in the main list as well
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
						// Use the same timestamp logic as for _chatsState, typically Date.now() or from response
						updatedChatInList.updatedAt = Date.now();
						newCachedChats[chatIndex] = updatedChatInList;

						// Move to top
						newCachedChats.splice(chatIndex, 1);
						newCachedChats.unshift(updatedChatInList);
						this._cachedChats = newCachedChats;
					}
				}
			}),
			mapTo(undefined),
		);
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
		// userContent will be prepared by prepareUserContentPayload
		return from(prepareUserContentPayload('', undefined, audio)).pipe(
			switchMap((userContent) => {
				// userContent is UserContentExt
				const payload: ChatMessagePayload = { llmId, userContent, options };

				// Optimistic update for user's audio message (placeholder)
				const audioUserMessage: ChatMessage = {
					id: uuidv4(),
					content: userContent, // Use the prepared content
					textContent: 'Audio message sent...', // Placeholder text
					isMine: true,
					createdAt: new Date().toISOString(),
				};

				const currentChatState = this._chatState();
				if (currentChatState.status === 'success') {
					this._chatState.set({
						status: 'success',
						data: {
							...currentChatState.data,
							messages: [...(currentChatState.data.messages || []), audioUserMessage],
						},
					});
				}

				// Returns Observable<Static<typeof LlmMessageSchema>>
				return callApiRoute(this._httpClient, CHAT_API.sendMessage, { pathParams: { chatId }, body: payload }).pipe(
					tap((apiLlmMessage) => {
						// apiLlmMessage is Static<LlmMessageSchema>
						const aiChatMessage = convertMessage(apiLlmMessage as ApiLlmMessage);

						const currentChatState = this._chatState();
						if (currentChatState.status === 'success') {
							// Replace the placeholder audio message
							const messagesWithoutPlaceholder = currentChatState.data.messages.filter((m) => m.id !== audioUserMessage.id);
							this._chatState.set({
								status: 'success',
								data: {
									...currentChatState.data,
									messages: [...messagesWithoutPlaceholder, aiChatMessage],
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
						console.error('Error sending audio message:', error);
						// Revert optimistic update
						const currentChatState = this._chatState();
						if (currentChatState.status === 'success') {
							this._chatState.set({
								status: 'success',
								data: {
									...currentChatState.data,
									messages: currentChatState.data.messages.filter((m) => m.id !== audioUserMessage.id),
								},
							});
						}
						return throwError(() => new Error('Failed to send audio message'));
					}),
				);
			}),
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
function convertMessage(apiLlmMessage: ApiLlmMessage): ChatMessage {
	const sourceApiContent = apiLlmMessage.content; // This is CoreContent from 'ai' (via shared/model/llm.model LlmMessage type)
	let chatMessageSpecificContent: UserContentExt; // Target type for ChatMessage.content

	if (typeof sourceApiContent === 'string') {
		chatMessageSpecificContent = sourceApiContent;
	} else if (Array.isArray(sourceApiContent)) {
		// Map parts from API's CoreContent to UserContentExt parts (TextPart, ImagePartExt, FilePartExt)
		const extendedParts: Array<TextPart | ImagePartExt | FilePartExt> = sourceApiContent
			.map((part) => {
				if (part.type === 'text') {
					return part as TextPart; // TextPart is directly compatible
				}
				if (part.type === 'image') {
					// API part is 'ai'.ImagePart, map to ImagePartExt
					const apiImgPart = part as import('ai').ImagePart;
					let imageValue = ''; // Default to empty string
					if (typeof apiImgPart.image === 'string') {
						imageValue = apiImgPart.image;
					} else if (apiImgPart.image instanceof URL) {
						imageValue = apiImgPart.image.toString();
					}
					// Add handling for other DataContent types if necessary in the future, e.g., Buffer to base64

					const imgExtPart: ImagePartExt = {
						type: 'image',
						image: imageValue, // Use the processed value
						mimeType: apiImgPart.mimeType,
						filename: (apiImgPart as any).filename || 'image.png', // Backend should provide these if available
						size: (apiImgPart as any).size || 0,
						externalURL: (apiImgPart as any).externalURL,
					};
					return imgExtPart;
				}
				if (part.type === 'file') {
					// API part is 'ai'.FilePart, map to FilePartExt
					const apiFilePart = part as import('ai').FilePart;
					let dataValue = ''; // Default to empty string
					if (typeof apiFilePart.data === 'string') {
						dataValue = apiFilePart.data;
					} else if (apiFilePart.data instanceof URL) {
						dataValue = apiFilePart.data.toString();
					}
					// Add handling for other DataContent types if necessary

					const fileExtPart: FilePartExt = {
						type: 'file',
						data: dataValue, // Use the processed value
						mimeType: apiFilePart.mimeType,
						filename: (apiFilePart as any).filename || 'file.bin', // Backend should provide these
						size: (apiFilePart as any).size || 0,
						externalURL: (apiFilePart as any).externalURL,
					};
					return fileExtPart;
				}
				return null; // Ignore other part types like tool_call for main display content
			})
			.filter((part) => part !== null) as Array<TextPart | ImagePartExt | FilePartExt>;

		if (extendedParts.length === 1 && extendedParts[0].type === 'text') {
			chatMessageSpecificContent = (extendedParts[0] as TextPart).text;
		} else if (extendedParts.length === 0) {
			chatMessageSpecificContent = ''; // Default for empty relevant parts (e.g., if only tool_call parts were present)
		} else {
			chatMessageSpecificContent = extendedParts;
		}
	} else {
		chatMessageSpecificContent = ''; // Default for undefined/null content or non-string/array types
	}

	// Derive UIMessage fields from the authoritative chatMessageSpecificContent for compatibility
	const { attachments: uiAttachmentsFromUserContent, text: uiTextContentForUIMessage } = userContentExtToAttachmentsAndText(chatMessageSpecificContent);

	let uiMessageCompatibleContentField: TextContent[] | undefined;
	if (typeof chatMessageSpecificContent === 'string') {
		uiMessageCompatibleContentField = [{ type: 'text', text: chatMessageSpecificContent }];
	} else {
		const textParts = chatMessageSpecificContent.filter((p) => p.type === 'text') as TextPart[];
		if (textParts.length > 0) {
			uiMessageCompatibleContentField = textParts.map((p) => ({ type: 'text', text: p.text }));
		} else if (uiTextContentForUIMessage && (!Array.isArray(chatMessageSpecificContent) || chatMessageSpecificContent.length === 0)) {
			// If UserContentExt was an empty string or empty array but userContentExtToAttachmentsAndText derived some text (e.g. placeholder)
			uiMessageCompatibleContentField = [{ type: 'text', text: uiTextContentForUIMessage }];
		}
	}
	if (
		uiMessageCompatibleContentField?.length === 0 &&
		uiTextContentForUIMessage === '' &&
		Array.isArray(chatMessageSpecificContent) &&
		chatMessageSpecificContent.length > 0
	) {
		// If UserContentExt has only attachments, textContent is empty, UIMessage.content should be undefined or empty
		uiMessageCompatibleContentField = undefined;
	}

	// Base UIMessage part
	const baseUiMessage: UIMessage = {
		id: (apiLlmMessage as any).id || uuidv4(), // Ensure all messages have a unique ID for trackBy
		textContent: uiTextContentForUIMessage,
		content: uiMessageCompatibleContentField, // UIMessage.content (TextContent[])
		imageAttachments: uiAttachmentsFromUserContent.filter((att) => att.type === 'image'),
		fileAttachments: uiAttachmentsFromUserContent.filter((att) => att.type === 'file'),
		stats: apiLlmMessage.stats,
		createdAt: apiLlmMessage.stats?.requestTime ? new Date(apiLlmMessage.stats.requestTime).toISOString() : new Date().toISOString(),
		llmId: apiLlmMessage.stats?.llmId,
		// textChunks is populated by displayedMessages in the ConversationComponent
	};

	// Construct ChatMessage, overriding UIMessage.content with UserContentExt
	return {
		...baseUiMessage,
		content: chatMessageSpecificContent, // This is ChatMessage.content (UserContentExt)
		isMine: apiLlmMessage.role === 'user',
		// generating is a UI-only state, not set from API message
	};
}
