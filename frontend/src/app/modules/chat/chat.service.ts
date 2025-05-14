import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {
    Attachment,
    Chat,
    ChatMessage,
    NEW_CHAT_ID,
    ServerChat,
    TextContent,
} from 'app/modules/chat/chat.types';
import {catchError, filter, map, Observable, of, switchMap, take, tap, throwError, mapTo} from 'rxjs';
import {FilePartExt, GenerateOptions, ImagePartExt, LlmMessage} from "#shared/model/llm.model";
import { signal, WritableSignal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ChatServiceClient {
    private readonly _chat: WritableSignal<Chat | null> = signal(null);
    readonly chat = this._chat.asReadonly();
    private readonly _chats: WritableSignal<Chat[] | null> = signal(null);
    readonly chats = this._chats.asReadonly();
    private _chatsLoaded = signal(false);


    constructor(private _httpClient: HttpClient) {}

    private base64ToBlob(base64: string, mimeType: string): Blob {
        const byteCharacters = atob(base64);
        const byteArrays = [];

        const sliceSize = 512;
        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);

            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }

            const byteArray = new Uint8Array(byteNumbers);

            byteArrays.push(byteArray);
        }

        return new Blob(byteArrays, { type: mimeType });
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Accessors
    // -----------------------------------------------------------------------------------------------------

    // chat and chats signals are exposed directly

    /**
     * Set the current chat (primarily for internal use or specific scenarios)
     */
    setChat(chat: Chat | null): void {
        this._chat.set(chat);
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Load chats from the server. Updates the `chats` signal.
     * @returns Observable<void> indicating completion or error.
     */
    loadChats(): Observable<void> {
        // Return cached chats if already loaded
        if (this._chatsLoaded()) {
            return of(undefined);
        }

        // Otherwise fetch from server
        return this._httpClient.get<Chat[]>('/api/chats').pipe(
            tap((response: any) // server returns {data: {chats: []}}
               ) => {
                this._chats.set(response.data.chats);
                this._chatsLoaded.set(true);
            }),
            mapTo(undefined),
            catchError((error) => {
                // Reset loaded flag on error to prevent caching failed state
                this._chatsLoaded.set(false);
                return throwError(() => error);
            })
        );
    }

    createChat(message: string, llmId: string, options?: GenerateOptions, attachments?: Attachment[]): Observable<Chat> {
        const formData = new FormData();
        formData.append('text', message);
        formData.append('llmId', llmId);
        if (options) formData.append('options', JSON.stringify(options));

        if (attachments && attachments.length > 0) {
            attachments.forEach((attachment, index) => {
                formData.append(`attachments[${index}]`, attachment.data, attachment.filename);
            });
        }

        return this._httpClient.post<any>('/api/chat/new', formData, { headers: { 'enctype': 'multipart/form-data' } }).pipe(
            map((response: any) => response.data as Chat), // server returns the full new chat object
            tap((newChat: Chat) => {
                // Convert server messages to UI messages
                newChat.messages = newChat.messages.map(convertMessage);
                this._chats.update(currentChats => [newChat, ...(currentChats || [])]);
                this._chat.set(newChat); // Also set the current chat to the new one
            })
        );
    }

    deleteChat(chatId: string): Observable<void> {
        return this._httpClient.delete<void>(`/api/chat/${chatId}`).pipe(
            tap(() => {
                this._chats.update(currentChats => (currentChats || []).filter(chat => chat.id !== chatId));
                if (this._chat()?.id === chatId) {
                    this._chat.set(null);
                }
            })
        );
    }

    /**
     * Load a specific chat by its ID. Updates the `chat` signal.
     * @param id The ID of the chat to load.
     * @returns Observable<void> indicating completion or error.
     */
    loadChatById(id: string): Observable<void> {
        if (!id?.trim() || id === NEW_CHAT_ID) {
            const newChat: Chat = { messages: [], id: NEW_CHAT_ID, title: '', updatedAt: Date.now() };
            this._chat.set(newChat);
            return of(undefined);
        }

        return this._httpClient.get<any>(`api/chat/${id}`).pipe( // server returns {data: Chat}
            map(response => response.data as ServerChat),
            tap((serverChat: ServerChat) => {
                const chat: Chat = {
                    id: serverChat.id,
                    title: serverChat.title,
                    messages: serverChat.messages.map(convertMessage),
                    updatedAt: serverChat.updatedAt,
                    userId: serverChat.userId,
                    shareable: serverChat.shareable,
                };
                this._chat.set(chat);

                // Update this chat in the main list if it exists
                this._chats.update(chats => {
                    const chatIndex = chats?.findIndex(c => c.id === id);
                    if (chats && chatIndex !== -1 && chatIndex !== undefined) {
                        const newChats = [...chats];
                        newChats[chatIndex] = chat; // Assuming ChatPreview and Chat are compatible enough for this update
                        return newChats;
                    }
                    return chats;
                });
            }),
            mapTo(undefined), // Convert Observable<Chat> to Observable<void>
            catchError(error => {
                this._chat.set(null); // Clear chat on error
                return throwError(() => error);
            })
        );
    }

    /**
     * Update chat title or other properties (not messages).
     * This is a simplified example. A more complete implementation might involve specific fields.
     * @param id
     * @param updatedProps Partial chat object with properties to update.
     */
    updateChatDetails(id: string, updatedProps: Partial<Chat>): Observable<void> {
        return this._httpClient.patch<Chat>(`api/chat/${id}/details`, updatedProps).pipe(
            map(response => response as Chat), // Assuming server returns the updated chat
            tap((updatedChatFromServer) => {
                 // Convert server messages if any (though this route might not return messages)
                if (updatedChatFromServer.messages) {
                    updatedChatFromServer.messages = updatedChatFromServer.messages.map(convertMessage);
                }
                this._chats.update(chats => {
                    const index = chats?.findIndex(item => item.id === id);
                    if (chats && index !== -1 && index !== undefined) {
                        const newChats = [...chats];
                        newChats[index] = { ...newChats[index], ...updatedChatFromServer };
                        return newChats;
                    }
                    return chats;
                });
                if (this._chat()?.id === id) {
                    this._chat.update(currentChat => ({ ...currentChat, ...updatedChatFromServer }));
                }
            }),
            mapTo(undefined)
        );
    }


    /**
     * Reset the selected chat
     */
    resetChat(): void {
        this._chat.set(null);
    }


    /**
     * Send a message. Updates the `chat` signal with the new user message and the AI's response.
     * @param chatId
     * @param message
     * @param llmId LLM identifier
     * @param attachments
     * @returns Observable<void> indicating completion of the send operation.
     */
    sendMessage(chatId: string, message: string, llmId: string, options?: GenerateOptions, attachments?: Attachment[]): Observable<void> {
        const formData = new FormData();
        formData.append('text', message);
        formData.append('llmId', llmId);
        if (options) formData.append('options', JSON.stringify(options));

        if (attachments && attachments.length > 0) {
            attachments.forEach((attachment, index) => {
                formData.append(`attachments[${index}]`, attachment.data, attachment.filename);
            });
        }

        // Locally add user's message immediately for responsiveness
        const userMessageEntry: ChatMessage = {
            content: [{ type: 'text', text: message }],
            textContent: message,
            isMine: true,
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


        return this._httpClient.post<any>(`/api/chat/${chatId}/send`, formData, { headers: { 'enctype': 'multipart/form-data' } }).pipe(
            map(response => response.data as LlmMessage), // Server returns the AI's LlmMessage
            tap((aiLlmMessage) => {
                const aiChatMessage = convertMessage(aiLlmMessage);
                this._chat.update(currentChat => {
                    if (!currentChat) return null;
                    // Replace the optimistic user message if it was simple, or append AI message
                    // For simplicity, we assume the user message is already there and just append AI
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
    }

    /**
     *
     * @param chatId
     * @param message
     * @param llmId
     */
    regenerateMessage(chatId: string, message: string, llmId: string): Observable<Chat> {
        if (!chatId?.trim() || !message?.trim() || !llmId?.trim()) {
            return throwError(() => new Error('Invalid parameters for regeneration'));
        }

        return this.chats$.pipe(
            take(1), // Not needed if we operate on current signal value
            switchMap(() => { // Removed chats from switchMap as we use this._chat()
                const currentChat = this._chat();
                if (!currentChat || currentChat.id !== chatId) {
                    return throwError(() => new Error(`Chat not found or not active: ${chatId}`));
                }

                // Optimistically remove messages after the point of regeneration, if desired
                // For now, let's assume the backend handles the message history for regeneration

                return this._httpClient.post<any>(`/api/chat/${chatId}/regenerate`, { text: message, llmId }).pipe(
                    map(response => response.data as LlmMessage),
                    tap(aiLlmMessage => {
                        const aiChatMessage = convertMessage(aiLlmMessage);
                        this._chat.update(chat => {
                            if (!chat) return null;
                            // Add the new AI message. Backend dictates history.
                            // If frontend needs to manage history truncation, logic goes here.
                            return {
                                ...chat,
                                messages: [...(chat.messages || []), aiChatMessage], // Simplified: appends. Proper regen might replace.
                                updatedAt: Date.now(),
                            };
                        });
                        // Update chat in the main list
                        this._chats.update(chats => {
                             const chatIndex = chats?.findIndex(c => c.id === chatId);
                             if (chats && chatIndex !== -1 && chatIndex !== undefined) {
                                 const newChats = [...chats];
                                 const updatedChatInList = { ...newChats[chatIndex] };
                                 // updatedChatInList.lastMessage = aiChatMessage.textContent;
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
                    mapTo(undefined), // Convert to Observable<void>
                    catchError(error => {
                        console.error('Error regenerating message:', error);
                        return throwError(() => new Error('Failed to regenerate message'));
                    })
                );
            })
        );
    }

    sendAudioMessage(chatId: string, llmId: string, audio: Blob): Observable<void> {
        const formData = new FormData();
        formData.append('audio', audio, 'audio.webm'); // Assuming webm, adjust if needed
        formData.append('llmId', llmId);

        // Optimistic update for audio could be adding a "sending audio..." message
        // For now, similar to text, wait for server response

        return this._httpClient.post<any>(`/api/chat/${chatId}/send`, formData, { headers: { 'enctype': 'multipart/form-data' } }).pipe(
            map(response => response.data as LlmMessage),
            tap(aiLlmMessage => {
                const aiChatMessage = convertMessage(aiLlmMessage);
                this._chat.update(currentChat => {
                    if (!currentChat) return null;
                    // Add a placeholder for user's audio message if desired, then AI response
                    // For simplicity, just adding AI response
                    return {
                        ...currentChat,
                        messages: [...(currentChat.messages || []), aiChatMessage], // Placeholder for user audio + AI response
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
                return throwError(() => new Error('Failed to send audio message'));
            })
        );
    }

    private getExtensionFromMimeType(mimeType: string): string {
        const mimeTypeMap: { [key: string]: string } = {
            'application/pdf': 'pdf',
            'text/plain': 'txt',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'image/jpeg': 'jpeg',
            'image/png': 'png',
            // Add other mime types and their extensions as needed
        };
        return mimeTypeMap[mimeType] || 'bin'; // Default to 'bin' if mime type is unknown
    }
}


/**
 * Convert the server Message type to the UI Message type
 * @param llmMessage
 */
function convertMessage(llmMessage: LlmMessage): ChatMessage {
    let allAttachments: Attachment[] = [];
    const texts: TextContent[] = []
    let textContent = ''

    if (Array.isArray(llmMessage.content)) {
        for(const content of llmMessage.content) {
            switch(content.type) {
                case 'text':
                    texts.push({
                        type: content.type,
                        text: content.text
                    })
                    textContent += content.text;
                    break;
                case 'reasoning':
                    texts.push({
                        type: content.type,
                        text: content.text
                    })
                    textContent += content.text + '\n\n';
                    break;
                case 'redacted-reasoning':
                    texts.push({
                        type: 'reasoning',
                        text: '<redacted>'
                    })
            }
        }

        // Convert the FilePart and ImageParts to Attachments
        allAttachments = llmMessage.content
            .filter(item => item.type === 'image' || item.type === 'file')
            .map(item => {
                if (item.type === 'image') {
                    const imagePart = item as ImagePartExt;

                    const mimeType = imagePart.mimeType || 'image/png';
                    const base64Data = imagePart.image as string;
                    const filename = imagePart.filename || `image_${Date.now()}.png`;

                    // Create a data URL
                    const dataUrl = `data:${mimeType};base64,${base64Data}`;

                    return {
                        type: 'image',
                        filename: filename,
                        size: base64Data.length,
                        data: null,
                        mimeType: mimeType,
                        previewUrl: dataUrl,
                    } as Attachment;
                } else if (item.type === 'file') {
                    const filePart = item as FilePartExt;

                    const mimeType = filePart.mimeType || 'application/octet-stream';
                    const base64Data = filePart.data as string;
                    const filename = filePart.filename || `file_${Date.now()}`;

                    // Create a data URL
                    const dataUrl = `data:${mimeType};base64,${base64Data}`;

                    return {
                        type: 'file',
                        filename: filename,
                        size: base64Data.length,
                        data: null,
                        mimeType: mimeType,
                        previewUrl: dataUrl, // Use data URL as preview for files too, or handle differently
                    } as Attachment;
                }
                return null; // Should not happen due to filter
            }).filter(att => att !== null);
    } else { // string content
        texts.push({type: 'text', text: llmMessage.content});
        textContent = llmMessage.content;
    }
console.log('stats')
    console.log(llmMessage.stats)
    return {
        textContent,
        content: texts,
        isMine: llmMessage.role === 'user',
        createdAt: llmMessage.stats?.requestTime ? new Date(llmMessage.stats.requestTime).toString() : new Date().toISOString(), // Add fallback for createdAt
        llmId: llmMessage.stats?.llmId,
        fileAttachments: allAttachments.filter(att => att.type === 'file'),
        imageAttachments: allAttachments.filter(att => att.type === 'image'),
        stats: llmMessage.stats
    };
}
