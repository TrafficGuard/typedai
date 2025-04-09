import {HttpClient} from '@angular/common/http';
import {Injectable} from '@angular/core';
import {
    Attachment,
    Chat,
    ChatMessage,
    GenerationStats,
    LlmMessage,
    NEW_CHAT_ID,
    ServerChat,
    TextContent,
} from 'app/modules/chat/chat.types';
import {BehaviorSubject, catchError, filter, map, Observable, Observer, of, switchMap, take, tap, throwError,} from 'rxjs';
import {GenerateOptions} from "app/core/user/user.types";
import {FilePartExt, ImagePartExt, TextPart} from "./ai.types";

/**
 * Events emitted during message streaming
 */
export type StreamEvent =
    | { type: 'chunk'; text: string }
    | { type: 'complete'; stats: GenerationStats }
    | { type: 'error'; error: any };

@Injectable({ providedIn: 'root' })
export class ChatService {
    private _chat: BehaviorSubject<Chat> = new BehaviorSubject(null);
    private _chats: BehaviorSubject<Chat[]> = new BehaviorSubject(null);
    /** Flag indicating whether chats have been loaded from the server */
    private _chatsLoaded: boolean = false;


    constructor(private _httpClient: HttpClient) {
        // Chats will be loaded on-demand via getChats()
    }

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

    /**
     * Getter for chat
     */
    get chat$(): Observable<Chat> {
        return this._chat.asObservable();
    }

    /**
     * Getter for chats
     */
    get chats$(): Observable<Chat[]> {
        return this._chats.asObservable();
    }

    /**
     * Set the current chat
     */
    setChat(chat: Chat): void {
        this._chat.next(chat);
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    /**
     * Get chats - returns cached data if available, otherwise fetches from server
     * @returns Observable of Chat array
     */
    getChats(): Observable<any> {
        // Return cached chats if already loaded
        if (this._chatsLoaded && this._chats.value) {
            return of(this._chats.value);
        }

        // Otherwise fetch from server
        return this._httpClient.get<Chat[]>('/api/chats').pipe(
            tap((response: Chat[]) => {
                response = (response as any).data.chats;
                this._chats.next(response);
                this._chatsLoaded = true;
            }),
            catchError((error) => {
                // Reset loaded flag on error to prevent caching failed state
                this._chatsLoaded = false;
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
            map((response: any) => {
                const newChat: Chat = response.data;
                const currentChats = this._chats.value || [];
                this._chats.next([newChat, ...currentChats]);
                return newChat;
            })
        );
    }

    deleteChat(chatId: string): Observable<void> {
        return this._httpClient.delete<void>(`/api/chat/${chatId}`).pipe(
            tap(() => {
                const currentChats = this._chats.value || [];
                this._chats.next(currentChats.filter(chat => chat.id !== chatId));
                if (this._chat.getValue()?.id === chatId) {
                    this._chat.next(null);
                }
            })
        );
    }

    /**
     * Get chat
     *
     * @param id
     */
    getChatById(id: string): Observable<any> {
        if(!id?.trim() || id === NEW_CHAT_ID) {
            const chat: Chat = { messages:[], id: NEW_CHAT_ID, title: '', updatedAt: Date.now() }
            this._chat.next(chat);
            return this._chats
        }
        return this._httpClient
            .get<Chat>(`api/chat/${id}`)
            .pipe(
                map((response: any) => {
                    // Update the chat
                    const serverChat: ServerChat = response.data

                    const chat: Chat = {
                        id: serverChat.id,
                        title: serverChat.title,
                        messages: serverChat.messages.map(convertMessage),
                        updatedAt: serverChat.updatedAt
                    }

                    // Set lastMessage
                    // const lastMessage = chat.messages[chat.messages.length - 1];
                    // chat.lastMessage = lastMessage ? lastMessage.content : '';

                    // this._chats doesn't have the messages, so we need to update it when we load a chat
                    const chats = this._chats.getValue()
                    const chatIndex = chats.findIndex(chat => chat.id === id);
                    chats[chatIndex] = chat;
                    this._chats.next(chats);

                    this._chat.next(chat);

                    // Return the chat
                    return chat;
                }),
                switchMap((chat: Chat) => {
                    if (!chat) {
                        return throwError(
                            'Could not found chat with id of ' + id + '!'
                        );
                    }

                    return of(chat);
                })
            );
    }

    /**
     * Update chat
     *
     * @param id
     * @param chat
     */
    updateChat(id: string, chat: Chat): Observable<Chat> {
        return this.chats$.pipe(
            take(1),
            switchMap((chats) =>
                this._httpClient
                    .patch<Chat>('api/chat/chat', {
                        id,
                        chat,
                    })
                    .pipe(
                        map((updatedChat) => {
                            // Find the index of the updated chat
                            const index = chats.findIndex(
                                (item) => item.id === id
                            );

                            // Update the chat
                            chats[index] = updatedChat;

                            // Update the chats
                            this._chats.next(chats);

                            // Return the updated contact
                            return updatedChat;
                        }),
                        switchMap((updatedChat) =>
                            this.chat$.pipe(
                                take(1),
                                filter((item) => item && item.id === id),
                                tap(() => {
                                    // Update the chat if it's selected
                                    this._chat.next(updatedChat);

                                    // Return the updated chat
                                    return updatedChat;
                                })
                            )
                        )
                    )
            )
        );
    }


    /**
     * Reset the selected chat
     */
    resetChat(): void {
        this._chat.next(null);
    }


    /**
     * Send a message
     *
     * @param chatId
     * @param message
     * @param llmId LLM identifier
     * @param attachments
     */
    sendMessage(chatId: string, message: string, llmId: string, options?: GenerateOptions, attachments?: Attachment[]): Observable<Chat> {
        const formData = new FormData();
        formData.append('text', message);
        formData.append('llmId', llmId);
        if (options) formData.append('options', JSON.stringify(options));

        if (attachments && attachments.length > 0) {
            attachments.forEach((attachment, index) => {
                formData.append(`attachments[${index}]`, attachment.data, attachment.filename);
            });
        }

        return this.chats$.pipe(
            take(1),
            switchMap((chats) =>
                this._httpClient
                    .post<Chat>(`/api/chat/${chatId}/send`, formData, { headers: { 'enctype': 'multipart/form-data' } })
                    .pipe(
                        map((data: any) => {
                            const llmMessage = data.data;

                            const newMessages: ChatMessage[] = [
                                {
                                    content: [{type:'text',text:message}],
                                    textContent: message,
                                    isMine: true,
                                    attachments: attachments,
                                },
                                {
                                    content: llmMessage,
                                    textContent: '',
                                    isMine: false,
                                },
                            ]
                            // Find the index of the updated chat
                            const index = chats.findIndex(
                                (item) => item.id === chatId
                            );
                            if(index < 0) {
                                console.log(`Couldn't find chat with id ${chatId} from ${chats.length} chats`);
                            }

                            // Update the chat
                            const chat = chats[index];
                            if(chat.messages === null || chat.messages === undefined) {
                                console.log(`nullish messages for ${JSON.stringify(chat)} at index ${index}`)
                                chat.messages = []
                            }
                            chat.messages.push(...newMessages);

                            // Move the chat to the top of the list
                            chats.splice(index, 1);
                            chats.unshift(chat);

                            // Update the chats
                            this._chats.next(chats);

                            // Update the chat if it's selected
                            this._chat.next(chat);

                            // Return the updated chat
                            return chat;
                        })
                    )
            )
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
            take(1),
            switchMap((chats) => {
                const chatIndex = chats.findIndex(item => item.id === chatId);
                if (chatIndex === -1) {
                    return throwError(() => new Error(`Chat not found: ${chatId}`));
                }

                return this._httpClient
                    .post<Chat>(`/api/chat/${chatId}/regenerate`, { text: message, llmId })
                    .pipe(
                        map((data: any) => {
                            const llmMessage = data.data;
                            const newMessage = {
                                value: llmMessage,
                                isMine: false,
                                llmId: llmId,
                                textContent: 'textContent todo'
                            };

                            const chat = chats[chatIndex];
                            chat.messages.push(newMessage);
                            chat.lastMessage = llmMessage;

                            // Update states
                            this._chats.next(chats);
                            this._chat.next(chat);

                            return chat;
                        }),
                        catchError(error => {
                            console.error('Error regenerating message:', error);
                            return throwError(() => new Error('Failed to regenerate message'));
                        })
                    );
            })
        );
    }

    /**
     * Streams a message from the LLM using Server-Sent Events
     * @param chatId The chat ID
     * @param message The user message text
     * @param llmId The LLM ID to use
     * @param options Optional generation options
     * @param attachments Optional file attachments
     * @returns Observable of StreamEvents (chunk, complete, error)
     */
    streamMessage(chatId: string, message: string, llmId: string, options?: GenerateOptions, attachments?: Attachment[]): Observable<StreamEvent> {
        // Wrap the logic inside the Observable constructor in an async function
        return new Observable((observer: Observer<StreamEvent>) => {
            const controller = new AbortController();
            const signal = controller.signal;

            // Define the async function to prepare and execute the fetch
            const executeFetch = async () => {
                try {
                    let userContentPayload: string | (TextPart | ImagePartExt | FilePartExt)[];

                    // --- Start: Attachment Handling Logic ---
                    if (attachments && attachments.length > 0) {
                        const userContentParts: (TextPart | ImagePartExt | FilePartExt)[] = [];

                        // Process attachments asynchronously
                        const attachmentPromises = attachments.map(async (attachment) => {
                            try {
                                // Read file data as base64 string
                                const base64Data = await this.readFileAsBase64(attachment.data);
                                if (attachment.type === 'image') {
                                    userContentParts.push({
                                        type: 'image',
                                        image: base64Data, // Base64 string without prefix
                                        mimeType: attachment.mimeType,
                                        filename: attachment.filename,
                                    } as ImagePartExt);
                                } else if (attachment.type === 'file') {
                                    userContentParts.push({
                                        type: 'file',
                                        data: base64Data, // Base64 string without prefix
                                        mimeType: attachment.mimeType,
                                        filename: attachment.filename,
                                    } as FilePartExt);
                                }
                            } catch (error) {
                                console.error(`Error reading attachment ${attachment.filename}:`, error);
                                // Propagate the error to stop the stream setup
                                throw new Error(`Failed to read attachment: ${attachment.filename}`);
                            }
                        });

                        // Wait for all attachments to be processed
                        await Promise.all(attachmentPromises);

                        // Add the text message part *after* attachments
                        userContentParts.push({ type: 'text', text: message });

                        userContentPayload = userContentParts;
                    } else {
                        // No attachments, send only text
                        userContentPayload = message;
                    }
                    // --- End: Attachment Handling Logic ---


                    const bodyPayload = {
                        userContent: userContentPayload, // Use the dynamically created payload
                        llmId: llmId,
                        options: options
                    };

                    // Proceed with the fetch call
                    const response = await fetch(`/api/chat/${chatId}/stream`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json', // Ensure correct Content-Type for JSON payload
                            'Accept': 'text/event-stream'
                        },
                        body: JSON.stringify(bodyPayload),
                        signal: signal
                    });

                    // ... rest of the fetch and stream reading logic ...

                    if (!response.ok) {
                        // Handle HTTP errors before streaming starts
                        const errorBody = await response.text();
                    throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
                }

                if (!response.body) {
                    throw new Error('Response body is null');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                function processText(text: string) {
                    buffer += text;
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep the last partial line

                    lines.forEach(line => {
                        if (line.startsWith('data:')) {
                            try {
                                const jsonData = line.substring(5).trim();
                                if (jsonData) {
                                    const eventData = JSON.parse(jsonData) as StreamEvent;
                                    observer.next(eventData);
                                    if (eventData.type === 'complete' || eventData.type === 'error') {
                                        observer.complete(); // Complete the observable on final events
                                    }
                                }
                            } catch (e) {
                                console.error('Failed to parse SSE data:', line, e);
                                observer.error({ type: 'error', error: 'Failed to parse stream data' });
                            }
                        }
                    });
                }

                async function readStream() {
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                // Process any remaining buffer content if needed
                                if (buffer.trim().startsWith('data:')) {
                                    processText('\n');
                                }
                                // Complete the observer when the stream ends, if not already completed/errored by stream data.
                                // RxJS handles multiple complete/error calls, so the check is not needed.
                                observer.complete();
                                break;
                            }
                            processText(decoder.decode(value, { stream: true }));
                        }
                    } catch (error) {
                        if ((error as DOMException).name === 'AbortError') {
                            console.log('Stream reading aborted.');
                            // Don't signal error on abort
                        } else {
                            console.error('Error reading stream:', error);
                            // If an error occurs, signal it to the observer.
                            // RxJS handles the observer state, no need to check if closed.
                            observer.error({ type: 'error', error: error });
                        }
                    } finally {
                        reader.releaseLock();
                    }
                }

                readStream();

                } catch (error) {
                    // Catch errors from async setup (file reading, initial fetch error)
                    console.error('Error setting up streamMessage fetch:', error);
                    // If an error occurs during setup, signal it to the observer.
                    // RxJS handles the observer state, no need to check if closed.
                    observer.error({ type: 'error', error: error });
                }
            };

            // Execute the async function
            executeFetch();

            // Return teardown logic
            return () => {
                console.log('Aborting fetch request for stream');
                controller.abort();
            };
        });
    }

    sendAudioMessage(chatId: string, llmId: string, audio: Blob): Observable<Chat> {
        return this.chats$.pipe(
            take(1),
            switchMap((chats) =>
                this._httpClient
                    .post<Chat>(`/api/chat/${chatId}/send`, { audio: audio, llmId })
                    .pipe(
                        map((data: any) => {
                            const llmMessage = data.data;

                            // const newMessages = [
                            //     {
                            //         value: message,
                            //         isMine: true,
                            //     },
                            //     {
                            //         value: llmMessage,
                            //         isMine: false,
                            //     },
                            // ]
                            // // Find the index of the updated chat
                            const index = chats.findIndex(
                                (item) => item.id === chatId
                            );
                            //
                            // // Update the chat
                            const chat =  chats[index];
                            // chat.messages.push(...newMessages);
                            // // Update the chats
                            this._chats.next(chats);
                            //
                            // // Update the chat if it's selected
                            this._chat.next(chat);
                            //
                            // // Return the updated chat
                            return chat;
                        })
                    )
            )
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

    /**
     * Reads a File object and returns its content as a base64 encoded string.
     * @param file The File object to read.
     * @returns A Promise that resolves with the base64 encoded string (without data URL prefix).
     */
    private readFileAsBase64(file: File): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                // Strip the data URL prefix (e.g., "data:image/png;base64,")
                const base64Data = result.split(',')[1];
                if (base64Data) {
                    resolve(base64Data);
                } else {
                    // Handle cases where splitting might fail or result is unexpected
                    reject(new Error('Failed to extract base64 data from file reader result.'));
                }
            };
            reader.onerror = (error) => {
                reject(error);
            };
            // Read the file as a Data URL to get base64 encoding
            reader.readAsDataURL(file);
        });
    }
}


/**
 * Convert the server Message type to the UI Message type
 * @param llmMessage
 */
function convertMessage(llmMessage: LlmMessage): ChatMessage {
        let attachments: Attachment[] = [];
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
            attachments = llmMessage.content
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
                            previewUrl: dataUrl,
                        } as Attachment;
                    }
                });
        } else { // string content
            texts.push({type: 'text', text: llmMessage.content});
            textContent = llmMessage.content;
        }

    return {
        textContent,
        content: texts,
        isMine: llmMessage.role === 'user',
        createdAt: new Date(llmMessage.stats?.requestTime).toString(),
        llmId: llmMessage.stats?.llmId,
        attachments
    };
}
