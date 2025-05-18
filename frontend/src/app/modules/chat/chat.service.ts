import { HttpClient } from '@angular/common/http';
import { Injectable, signal, WritableSignal } from '@angular/core';
import { Observable, of, throwError, from } from 'rxjs';
import { catchError, map, mapTo, tap, switchMap } from 'rxjs/operators';

import { CHAT_API } from '#shared/api/chat.api';
import type {
    ChatSchemaModel as ApiChatModel,
    ChatMessagePayload,
    RegenerateMessagePayload,
    ChatUpdateDetailsPayload,
    ChatMarkdownRequestPayload,
    ChatMarkdownResponseModel,
} from '#shared/schemas/chat.schema';

import type { LlmMessage as ApiLlmMessage } from '#shared/model/llm.model';
import { UserContentExt, TextPart, ImagePartExt, FilePartExt, CallSettings } from '#shared/model/llm.model';

import { callApiRoute } from 'app/core/api-route';
import {
    Chat,
    ChatMessage,
    NEW_CHAT_ID,
    // ServerChat is effectively ApiChatModel now
} from 'app/modules/chat/chat.types';
import type { Attachment, TextContent } from 'app/modules/message.types';

// Helper function to convert File to base64 string (extracting only the data part)
async function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.readAsDataURL(file);
		reader.onload = () => {
			const result = reader.result as string;
			resolve(result.substring(result.indexOf(',') + 1));
		};
		reader.onerror = error => reject(error);
	});
}

// Helper function to prepare UserContentExt payload for API calls
async function prepareUserContentPayload(
	text: string,
	attachments?: Attachment[],
	audioBlob?: Blob,
	audioFileName: string = 'audio.webm', // Default filename for audio
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
			} else { // 'file'
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
			reader.onerror = error => reject(error);
		});
		contentParts.push({ // Represent audio as a generic file part
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
    private readonly _chat: WritableSignal<Chat | null> = signal(null);
    readonly chat = this._chat.asReadonly();
    private readonly _chats: WritableSignal<Chat[] | null> = signal(null);
    readonly chats = this._chats.asReadonly();
    private _chatsLoaded = signal(false);


    constructor(private _httpClient: HttpClient) {}

    setChat(chat: Chat | null): void {
        this._chat.set(chat);
    }

    loadChats(): Observable<void> {
        if (this._chatsLoaded()) {
            return of(undefined);
        }
        // callApiRoute infers response type: Observable<Static<typeof ChatListSchema>>
        return callApiRoute(this._httpClient, CHAT_API.listChats).pipe(
            tap((apiChatList) => { // apiChatList is Static<typeof ChatListSchema>
                // apiChatList.chats is ChatPreviewSchema[]
                // Map ApiChatPreview to UI Chat for the list
                const uiChats: Chat[] = apiChatList.chats.map(preview => ({
                    id: preview.id,
                    title: preview.title,
                    updatedAt: preview.updatedAt,
                    userId: preview.userId,
                    shareable: preview.shareable,
                    parentId: preview.parentId,
                    rootId: preview.rootId,
                    // messages, unreadCount, lastMessage, lastMessageAt are not in ChatPreview
                }));
                this._chats.set(uiChats);
                this._chatsLoaded.set(true);
            }),
            mapTo(undefined),
            catchError((error) => {
                this._chatsLoaded.set(false);
                return throwError(() => error);
            })
        );
    }

    createChat(message: string, llmId: string, options?: CallSettings, attachments?: Attachment[]): Observable<Chat> {
        // Need to wrap the async call in 'from' and use switchMap
        return from(prepareUserContentPayload(message, attachments)).pipe(
            switchMap(userContent => {
                const payload: ChatMessagePayload = { llmId, userContent, options };
                // Returns Observable<Static<typeof ChatModelSchema>>
                return callApiRoute(this._httpClient, CHAT_API.createChat, { body: payload }).pipe(
                    map((newApiChat: ApiChatModel) => {
                        const uiChat: Chat = {
                            ...newApiChat, // Spread properties like id, title, userId, shareable, parentId, rootId, updatedAt
                            messages: newApiChat.messages.map(msg => convertMessage(msg as ApiLlmMessage)), // msg is Static<LlmMessageSchema>
                        };
                        this._chats.update(currentChats => [uiChat, ...(currentChats || [])]);
                        this._chat.set(uiChat);
                        return uiChat;
                    })
                );
            })
        );
    }

    deleteChat(chatId: string): Observable<void> {
        // Returns Observable<null> for 204 response
        return callApiRoute(this._httpClient, CHAT_API.deleteChat, { pathParams: { chatId } }).pipe(
            tap(() => {
                this._chats.update(currentChats => (currentChats || []).filter(chat => chat.id !== chatId));
                if (this._chat()?.id === chatId) {
                    this._chat.set(null);
                }
            })
            // No mapTo(undefined) needed as callApiRoute for 204 already returns Observable<void> (or Observable<null>)
        );
    }

    loadChatById(id: string): Observable<void> {
        if (!id?.trim() || id === NEW_CHAT_ID) {
            const newChat: Chat = { messages: [], id: NEW_CHAT_ID, title: '', updatedAt: Date.now() };
            this._chat.set(newChat);
            return of(undefined);
        }

        // Returns Observable<Static<typeof ChatModelSchema>>
        return callApiRoute(this._httpClient, CHAT_API.getById, { pathParams: { chatId: id } }).pipe(
            tap((apiChat: ApiChatModel) => {
                const uiChat: Chat = {
                    ...apiChat, // Spread properties like id, title, userId, shareable, parentId, rootId, updatedAt
                    messages: apiChat.messages.map(msg => convertMessage(msg as ApiLlmMessage)),
                };
                this._chat.set(uiChat);
                this._chats.update(chats => {
                    const chatIndex = chats?.findIndex(c => c.id === id);
                    if (chats && chatIndex !== -1 && chatIndex !== undefined) {
                        const newChats = [...chats];
                        // Update the existing chat preview in the list with details from the full chat
                        newChats[chatIndex] = {
                            ...newChats[chatIndex], // Keep existing preview properties
                            ...uiChat, // Overwrite with full chat properties (title, updatedAt, parentId, rootId etc.)
                            messages: newChats[chatIndex].messages // Do NOT add full messages to the preview list
                        };
                        return newChats;
                    }
                    // If chat was not in the list (shouldn't happen if loadChats was called), add it?
                    // return chats ? [...chats, uiChat] : [uiChat]; // Optional: add if not found
                    return chats; // Current logic only updates existing.
                });
            }),
            mapTo(undefined),
            catchError(error => {
                this._chat.set(null);
                return throwError(() => error);
            })
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
                this._chats.update(chats => {
                    const index = chats?.findIndex(item => item.id === id);
                    if (chats && index !== -1 && index !== undefined) {
                        const newChats = [...chats];
                        newChats[index] = { ...newChats[index], ...uiChatUpdate };
                        return newChats;
                    }
                    return chats;
                });
                if (this._chat()?.id === id) {
                    this._chat.update(currentChat => ({ ...currentChat, ...uiChatUpdate }));
                }
            }),
            mapTo(undefined)
        );
    }

    resetChat(): void {
        this._chat.set(null);
    }

    sendMessage(chatId: string, message: string, llmId: string, options?: CallSettings, attachments?: Attachment[]): Observable<void> {
        // Need to wrap the async call in 'from' and use switchMap
        return from(prepareUserContentPayload(message, attachments)).pipe(
            switchMap(userContent => {
                const payload: ChatMessagePayload = { llmId, userContent, options };

                // Locally add user's message immediately for responsiveness
                const userMessageEntry: ChatMessage = {
                    // id: uuidv4(), // ID can be added by component or later if needed for specific tracking
                    // Construct content array based on the prepared userContent
                    content: typeof userContent === 'string'
                        ? [{ type: 'text', text: userContent }]
                        : userContent.map(p => {
                            if (p.type === 'text') return { type: 'text', text: p.text };
                            // For attachments being sent, we might just show a placeholder or filename
                            return { type: p.type, text: (p as any).filename || 'attachment' };
                        }),
                    textContent: message, // Keep original text for display if needed
                    isMine: true,
                    // Store the original attachments being sent for potential display/preview before upload completes
                    fileAttachments: attachments?.filter(att => att.type === 'file') || [],
                    imageAttachments: attachments?.filter(att => att.type === 'image') || [],
                    createdAt: new Date().toISOString(), // Add timestamp
                };
                this._chat.update(currentChat => {
                    if (!currentChat) return null; // Should not happen if sending to an existing chat
                    return {
                        ...currentChat,
                        messages: [...(currentChat.messages || []), userMessageEntry],
                    };
                });


                // Returns Observable<Static<typeof LlmMessageSchema>>
                return callApiRoute(this._httpClient, CHAT_API.sendMessage, { pathParams: { chatId }, body: payload }).pipe(
                    tap((apiLlmMessage) => { // apiLlmMessage is Static<LlmMessageSchema>
                        const aiChatMessage = convertMessage(apiLlmMessage as ApiLlmMessage);
                        this._chat.update(currentChat => {
                            if (!currentChat) return null;
                            // Now, currentChat.messages already contains the userMessageEntry from the optimistic update above.
                            // We just append the AI's response.
                            return {
                                ...currentChat,
                                messages: [...(currentChat.messages || []), aiChatMessage],
                                updatedAt: Date.now(), // Update timestamp
                            };
                        });
                        // Update the chat in the main list as well
                        this._chats.update(chats => {
                            const chatIndex = chats?.findIndex(c => c.id === chatId);
                            if (chats && chatIndex !== -1 && chatIndex !== undefined) {
                                const newChats = [...chats];
                                const updatedChatInList = { ...newChats[chatIndex] };
                                // updatedChatInList.lastMessage = aiChatMessage.textContent; // Update last message if applicable
                                updatedChatInList.updatedAt = Date.now();
                                newChats[chatIndex] = updatedChatInList;
                                // Move to top
                                newChats.splice(chatIndex, 1);
                                newChats.unshift(updatedChatInList);
                                return newChats;
                            }
                            return chats;
                        });
                    }),
                    mapTo(undefined) // Convert to Observable<void>
                );
            })
        );
    }

    regenerateMessage(chatId: string, message: string, llmId: string, historyTruncateIndex: number, options?: CallSettings): Observable<void> {
        if (!chatId?.trim() || !llmId?.trim()) {
            return throwError(() => new Error('Invalid parameters for regeneration'));
        }
        const currentChat = this._chat();
        if (!currentChat || currentChat.id !== chatId) {
            return throwError(() => new Error(`Chat not found or not active: ${chatId}`));
        }

        // Need to wrap the async call in 'from' and use switchMap
        return from(prepareUserContentPayload(message)).pipe( // 'message' is the new user prompt
            switchMap(userContent => {
                const payload: RegenerateMessagePayload = { userContent, llmId, historyTruncateIndex, options };

                // Returns Observable<Static<typeof LlmMessageSchema>>
                return callApiRoute(this._httpClient, CHAT_API.regenerateMessage, { pathParams: { chatId }, body: payload }).pipe(
                    tap(apiLlmMessage => { // apiLlmMessage is Static<LlmMessageSchema>
                        const aiChatMessage = convertMessage(apiLlmMessage as ApiLlmMessage);
                        this._chat.update(chat => {
                            if (!chat) return null;
                            // The backend has handled history truncation.
                            // The new AI message is the latest. We need to reconstruct the message list
                            // based on what the backend now considers the true state.
                            // For simplicity, assume the service call to loadChatById or similar would refresh if full state is needed,
                            // or the backend could return the full updated chat.
                            // Here, we'll replace messages from historyTruncateIndex with the new AI message.
                            // This assumes the user prompt that led to this is ALREADY in chat.messages or handled by backend.
                            // A more robust way: backend returns the full updated Chat object.
                            // Since it only returns LlmMessage, we'll update the current chat optimistically.
                            const messagesUpToPrompt = chat.messages.slice(0, historyTruncateIndex); // messages before the AI response being regenerated
                            // If the regeneration included a new user prompt (`message` was non-empty),
                            // we might need to add it here before the AI response.
                            // However, the backend's RegenerateMessageSchema takes `userContent`, implying the backend
                            // expects the user prompt as part of the regeneration request and will handle adding it to history.
                            // So, we just append the new AI message.
                            return { ...chat, messages: [...messagesUpToPrompt, aiChatMessage], updatedAt: Date.now() };
                        });
                         // Update chat in the main list
                        this._chats.update(chats => {
                             const chatIndex = chats?.findIndex(c => c.id === chatId);
                             if (chats && chatIndex !== -1 && chatIndex !== undefined) {
                                 const newChats = [...chats];
                                 const updatedChatInList = { ...newChats[chatIndex] };
                                 updatedChatInList.updatedAt = Date.now();
                                 newChats[chatIndex] = updatedChatInList;
                                 // Move to top
                                 newChats.splice(chatIndex, 1);
                                 newChats.unshift(updatedChatInList);
                                 return newChats;
                             }
                             return chats;
                        });
                    }),
                    mapTo(undefined),
                    catchError(error => {
                        console.error('Error regenerating message:', error);
                        return throwError(() => new Error('Failed to regenerate message'));
                    })
                );
            })
        );
    }

    sendAudioMessage(chatId: string, llmId: string, audio: Blob, options?: CallSettings): Observable<void> {
        // Need to wrap the async call in 'from' and use switchMap
        return from(prepareUserContentPayload('', undefined, audio)).pipe( // No text, just audio
            switchMap(userContent => {
                const payload: ChatMessagePayload = { llmId, userContent, options };

                // Optimistic update for user's audio message (placeholder)
                const audioUserMessage: ChatMessage = {
                    content: [{ type: 'text', text: 'Audio message sent...' }], // Placeholder
                    textContent: 'Audio message sent...',
                    isMine: true,
                    createdAt: new Date().toISOString(),
                    // Could include a simplified Attachment representation for the audio
                };
                this._chat.update(currentChat => {
                    if (!currentChat) return null;
                    return { ...currentChat, messages: [...(currentChat.messages || []), audioUserMessage] };
                });

                // Returns Observable<Static<typeof LlmMessageSchema>>
                return callApiRoute(this._httpClient, CHAT_API.sendMessage, { pathParams: { chatId }, body: payload }).pipe(
                    tap(apiLlmMessage => { // apiLlmMessage is Static<LlmMessageSchema>
                        const aiChatMessage = convertMessage(apiLlmMessage as ApiLlmMessage);
                        this._chat.update(currentChat => {
                            if (!currentChat) return null;
                            // Find and replace the placeholder audio message, or just append if not found/needed
                            const messagesWithoutPlaceholder = currentChat.messages.filter(m => m.textContent !== 'Audio message sent...' || !m.isMine);
                            return {
                                ...currentChat,
                                messages: [...messagesWithoutPlaceholder, aiChatMessage],
                                updatedAt: Date.now(),
                            };
                        });
                         // Update chat in the main list
                        this._chats.update(chats => {
                             const chatIndex = chats?.findIndex(c => c.id === chatId);
                             if (chats && chatIndex !== -1 && chatIndex !== undefined) {
                                 const newChats = [...chats];
                                 const updatedChatInList = { ...newChats[chatIndex] };
                                 // updatedChatInList.lastMessage = "Audio message response"; // Or actual text
                                 updatedChatInList.updatedAt = Date.now();
                                 newChats[chatIndex] = updatedChatInList;
                                 // Move to top
                                 newChats.splice(chatIndex, 1);
                                 newChats.unshift(updatedChatInList);
                                 return newChats;
                             }
                             return chats;
                        });
                    }),
                    mapTo(undefined),
                    catchError(error => {
                        console.error('Error sending audio message:', error);
                        // Revert optimistic update if needed
                        this._chat.update(currentChat => {
                            if (!currentChat) return null;
                            return { ...currentChat, messages: currentChat.messages.filter(m => m.textContent !== 'Audio message sent...' || !m.isMine) };
                        });
                        return throwError(() => new Error('Failed to send audio message'));
                    })
                );
            })
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
            })
        );
    }
}

/**
 * Convert the server LlmMessage (API model) to the UI ChatMessage type
 * @param apiLlmMessage This is effectively Static<typeof LlmMessageSchema>
 */
function convertMessage(apiLlmMessage: ApiLlmMessage): ChatMessage { // ApiLlmMessage from shared/model
    let allAttachmentsUI: Attachment[] = []; // This is the UI Attachment type
    const texts: TextContent[] = [];
    let textContent = '';

    const content = apiLlmMessage.content; // Content can be string or array of parts

    if (Array.isArray(content)) {
        for (const part of content) { // part is one of TextPart, ImagePartExt, FilePartExt, ToolCallPart etc.
            switch (part.type) {
                case 'text':
                    texts.push({ type: 'text', text: part.text });
                    textContent += part.text;
                    break;
                // case 'reasoning': // Assuming 'reasoning' and 'redacted-reasoning' are custom and map to text or specific UI.
                //     texts.push({ type: 'reasoning', text: part.text });
                //     textContent += part.text + '\n\n';
                //     break;
                // case 'redacted-reasoning':
                //     texts.push({ type: 'reasoning', text: '<redacted>' });
                //     break;
                case 'image':
                    const imagePart = part as ImagePartExt; // From shared/model/llm.model
                    // Use externalURL if available, otherwise use base64 data
                    const imgPreviewUrl = imagePart.externalURL || (typeof imagePart.image === 'string' ? `data:${imagePart.mimeType || 'image/png'};base64,${imagePart.image}` : undefined);

                    allAttachmentsUI.push({
                        type: 'image',
                        filename: imagePart.filename || `image_${Date.now()}.png`,
                        size: imagePart.size || (typeof imagePart.image === 'string' ? imagePart.image.length : 0), // Approx size
                        data: null, // No raw File object for received attachments
                        mimeType: imagePart.mimeType || 'image/png',
                        previewUrl: imgPreviewUrl,
                    });
                    // Optionally add a placeholder text for images if not rendered inline
                    // textContent += `[Image: ${imagePart.filename || 'image'}]\n`;
                    break;
                case 'file':
                    const filePart = part as FilePartExt; // From shared/model/llm.model
                     // Use externalURL if available, otherwise use base64 data
                    const filePreviewUrl = filePart.externalURL || (typeof filePart.data === 'string' ? `data:${filePart.mimeType || 'application/octet-stream'};base64,${filePart.data}` : undefined);

                    allAttachmentsUI.push({
                        type: 'file',
                        filename: filePart.filename || `file_${Date.now()}`,
                        size: filePart.size || (typeof filePart.data === 'string' ? filePart.data.length : 0), // Approx size
                        data: null, // No raw File object
                        mimeType: filePart.mimeType || 'application/octet-stream',
                        previewUrl: filePreviewUrl, // Or a generic link/icon
                    });
                    // textContent += `[File: ${filePart.filename || 'file'}]\n`;
                    break;
                // Handle other part types like 'tool-call', 'tool-result' if they need specific UI representation
            }
        }
    } else if (typeof content === 'string') {
        texts.push({ type: 'text', text: content });
        textContent = content;
    }

    return {
        id: (apiLlmMessage as any).id || undefined, // LlmMessage doesn't have an ID, but ChatMessage UI might
        textContent,
        content: texts.length > 0 ? texts : [{type: 'text', text: textContent}], // Ensure content array is not empty if textContent exists
        isMine: apiLlmMessage.role === 'user',
        createdAt: apiLlmMessage.stats?.requestTime ? new Date(apiLlmMessage.stats.requestTime).toISOString() : new Date().toISOString(),
        llmId: apiLlmMessage.stats?.llmId,
        fileAttachments: allAttachmentsUI.filter(att => att.type === 'file'),
        imageAttachments: allAttachmentsUI.filter(att => att.type === 'image'),
        stats: apiLlmMessage.stats,
        // generating: false, // This would be set by UI during streaming
    };
}
