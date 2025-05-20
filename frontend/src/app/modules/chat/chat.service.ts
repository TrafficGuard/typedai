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
import { v4 as uuidv4 } from 'uuid';
import { userContentExtToAttachmentsAndText } from 'app/modules/messageUtil';
import { UIMessage } from 'app/modules/message.types';

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

    createChat(userContent: UserContentExt, llmId: string, options?: CallSettings): Observable<Chat> {
        // userContent is already prepared by the component
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

    sendMessage(chatId: string, userContent: UserContentExt, llmId: string, options?: CallSettings, attachmentsForUI?: Attachment[]): Observable<void> {
        // userContent is already prepared by the component
        const payload: ChatMessagePayload = { llmId, userContent, options };

        // Locally add user's message immediately for responsiveness
        const { text: derivedTextFromUserContent } = userContentExtToAttachmentsAndText(userContent);
        const userMessageEntry: ChatMessage = {
            id: uuidv4(), // Add unique ID for optimistic update
            content: userContent,
            textContent: derivedTextFromUserContent,
            isMine: true,
            fileAttachments: attachmentsForUI?.filter(att => att.type === 'file') || [],
            imageAttachments: attachmentsForUI?.filter(att => att.type === 'image') || [],
            createdAt: new Date().toISOString(),
        };
        this._chat.update(currentChat => {
            if (!currentChat) return null;
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
                    // Replace the optimistically added user message if it had a temporary ID,
                    // or simply append the AI message if the user message is already final.
                    // For simplicity, we assume the optimistic user message is final and just append AI response.
                    // A more robust approach might involve matching IDs if temporary IDs were used.
                    return {
                        ...currentChat,
                        messages: [...(currentChat.messages || []), aiChatMessage], // Appends AI message
                        updatedAt: Date.now(),
                    };
                });
                // Update the chat in the main list as well
                this._chats.update(chats => {
                    const chatIndex = chats?.findIndex(c => c.id === chatId);
                    if (chats && chatIndex !== -1 && chatIndex !== undefined) {
                        const newChats = [...chats];
                        const updatedChatInList = { ...newChats[chatIndex] };
                        // updatedChatInList.lastMessage = aiChatMessage.textContent; // Consider updating last message
                        updatedChatInList.updatedAt = Date.now();
                        newChats[chatIndex] = updatedChatInList;
                        newChats.splice(chatIndex, 1);
                        newChats.unshift(updatedChatInList);
                        return newChats;
                    }
                    return chats;
                });
            }),
            mapTo(undefined)
        );
    }

    regenerateMessage(chatId: string, userContent: UserContentExt, llmId: string, historyTruncateIndex: number, options?: CallSettings): Observable<void> {
        if (!chatId?.trim() || !llmId?.trim()) {
            return throwError(() => new Error('Invalid parameters for regeneration'));
        }
        const currentChat = this._chat();
        if (!currentChat || currentChat.id !== chatId) {
            return throwError(() => new Error(`Chat not found or not active: ${chatId}`));
        }

        // userContent is already prepared by the component (it's the content of the message to regenerate from)
        const payload: RegenerateMessagePayload = { userContent, llmId, historyTruncateIndex, options };

        // Returns Observable<Static<typeof LlmMessageSchema>>
        return callApiRoute(this._httpClient, CHAT_API.regenerateMessage, { pathParams: { chatId }, body: payload }).pipe(
            tap(apiLlmMessage => { // apiLlmMessage is Static<LlmMessageSchema>
                const aiChatMessage = convertMessage(apiLlmMessage as ApiLlmMessage);
                this._chat.update(chat => {
                    if (!chat) return null;
                    // Backend handles history truncation. The new AI message is the latest.
                    // We replace messages from historyTruncateIndex with the new AI message.
                    const messagesUpToPrompt = chat.messages.slice(0, historyTruncateIndex);
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
    }

    sendAudioMessage(chatId: string, llmId: string, audio: Blob, options?: CallSettings): Observable<void> {
        // userContent will be prepared by prepareUserContentPayload
        return from(prepareUserContentPayload('', undefined, audio)).pipe(
            switchMap(userContent => { // userContent is UserContentExt
                const payload: ChatMessagePayload = { llmId, userContent, options };

                // Optimistic update for user's audio message (placeholder)
                const audioUserMessage: ChatMessage = {
                    id: uuidv4(),
                    content: userContent, // Use the prepared content
                    textContent: 'Audio message sent...', // Placeholder text
                    isMine: true,
                    createdAt: new Date().toISOString(),
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
                            // Replace the placeholder audio message
                            const messagesWithoutPlaceholder = currentChat.messages.filter(m => m.id !== audioUserMessage.id);
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
                                 // updatedChatInList.lastMessage = "Audio message response";
                                 updatedChatInList.updatedAt = Date.now();
                                 newChats[chatIndex] = updatedChatInList;
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
                        this._chat.update(currentChat => { // Revert optimistic update
                            if (!currentChat) return null;
                            return { ...currentChat, messages: currentChat.messages.filter(m => m.id !== audioUserMessage.id) };
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
function convertMessage(apiLlmMessage: ApiLlmMessage): ChatMessage {
    const sourceApiContent = apiLlmMessage.content; // This is CoreContent from 'ai' (via shared/model/llm.model LlmMessage type)
    let chatMessageSpecificContent: UserContentExt; // Target type for ChatMessage.content

    if (typeof sourceApiContent === 'string') {
        chatMessageSpecificContent = sourceApiContent;
    } else if (Array.isArray(sourceApiContent)) {
        // Map parts from API's CoreContent to UserContentExt parts (TextPart, ImagePartExt, FilePartExt)
        const extendedParts: Array<TextPart | ImagePartExt | FilePartExt> = sourceApiContent
            .map(part => {
                if (part.type === 'text') {
                    return part as TextPart; // TextPart is directly compatible
                } else if (part.type === 'image') {
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
                        filename: (apiImgPart as any).filename || `image.png`, // Backend should provide these if available
                        size: (apiImgPart as any).size || 0,
                        externalURL: (apiImgPart as any).externalURL,
                    };
                    return imgExtPart;
                } else if (part.type === 'file') {
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
                        filename: (apiFilePart as any).filename || `file.bin`, // Backend should provide these
                        size: (apiFilePart as any).size || 0,
                        externalURL: (apiFilePart as any).externalURL,
                    };
                    return fileExtPart;
                }
                return null; // Ignore other part types like tool_call for main display content
            })
            .filter(part => part !== null) as Array<TextPart | ImagePartExt | FilePartExt>;

        if (extendedParts.length === 1 && extendedParts[0].type === 'text') {
            chatMessageSpecificContent = (extendedParts[0] as TextPart).text;
        } else if (extendedParts.length === 0) {
            chatMessageSpecificContent = ""; // Default for empty relevant parts (e.g., if only tool_call parts were present)
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
        const textParts = chatMessageSpecificContent.filter(p => p.type === 'text') as TextPart[];
        if (textParts.length > 0) {
            uiMessageCompatibleContentField = textParts.map(p => ({ type: 'text', text: p.text }));
        } else if (uiTextContentForUIMessage && (!Array.isArray(chatMessageSpecificContent) || chatMessageSpecificContent.length === 0)) {
            // If UserContentExt was an empty string or empty array but userContentExtToAttachmentsAndText derived some text (e.g. placeholder)
            uiMessageCompatibleContentField = [{ type: 'text', text: uiTextContentForUIMessage }];
        }
    }
    if (uiMessageCompatibleContentField?.length === 0 && uiTextContentForUIMessage === '' && Array.isArray(chatMessageSpecificContent) && chatMessageSpecificContent.length > 0) {
        // If UserContentExt has only attachments, textContent is empty, UIMessage.content should be undefined or empty
         uiMessageCompatibleContentField = undefined;
    }


    // Base UIMessage part
    const baseUiMessage: UIMessage = {
        id: (apiLlmMessage as any).id || uuidv4(), // Ensure all messages have a unique ID for trackBy
        textContent: uiTextContentForUIMessage,
        content: uiMessageCompatibleContentField, // UIMessage.content (TextContent[])
        imageAttachments: uiAttachmentsFromUserContent.filter(att => att.type === 'image'),
        fileAttachments: uiAttachmentsFromUserContent.filter(att => att.type === 'file'),
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
