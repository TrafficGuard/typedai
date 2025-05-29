import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ChatServiceClient } from './chat.service';
import { CHAT_API } from '#shared/api/chat.api';
import type { Chat as UIChat, ChatMessage, NEW_CHAT_ID } from 'app/modules/chat/chat.types';
import type { UserContentExt } from '#shared/model/llm.model';
import type { Static } from '@sinclair/typebox';
import { of, throwError, EMPTY } from 'rxjs';
import {
    ChatListSchema,
    ChatMarkdownRequestSchema,
    ChatMarkdownResponseSchema,
    ChatMessageSendSchema,
    ChatModelSchema,
    ChatUpdateDetailsSchema,
    RegenerateMessageSchema,
    ChatPreviewSchema, // Added for mockApiChatList
} from '#shared/schemas/chat.schema';
import { LlmMessageSchema } from '#shared/schemas/llm.schema';
import { convertMessage } from './chat.service'; // For direct testing if needed, or rely on service methods
import { userContentExtToAttachmentsAndText } from 'app/modules/messageUtil';

// Helper to create a minimal valid API Chat Model
const createMockApiChatModel = (id: string, title: string, messages: Static<typeof LlmMessageSchema>[] = []): Static<typeof ChatModelSchema> => ({
    id,
    userId: 'user-test-id',
    shareable: false,
    title,
    updatedAt: Date.now(),
    messages,
    parentId: undefined,
    rootId: undefined,
});

// Helper to create a minimal valid API LLM Message
const createMockApiLlmMessage = (id: string, role: 'user' | 'assistant' | 'system', content: UserContentExt, requestTime: number = Date.now()): Static<typeof LlmMessageSchema> => ({
    role,
    content,
    // Mocking a minimal stats object; adjust as needed for specific tests
    stats: {
        requestTime,
        timeToFirstToken: 50,
        totalTime: 100,
        inputTokens: 10,
        outputTokens: 20,
        cost: 0.001,
        llmId: 'test-llm-id',
    },
    // id is not part of LlmMessageSchema, but often added in UI models.
    // The convertMessage function generates a UUID if not present on the API message.
});


describe('ChatServiceClient', () => {
    let service: ChatServiceClient;
    let httpMock: HttpTestingController;

    const mockApiChat1 = createMockApiChatModel('chat1', 'Chat One');
    const mockApiChat2 = createMockApiChatModel('chat2', 'Chat Two');

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [HttpClientTestingModule],
            providers: [ChatServiceClient],
        });
        service = TestBed.inject(ChatServiceClient);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify(); // Make sure that there are no outstanding requests
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('loadChats', () => {
        it('should return cached chats and not call API if cache is populated and service is not loading', fakeAsync(() => {
            const mockChats: UIChat[] = [{ id: '1', title: 'Test Chat', updatedAt: Date.now(), messages: [] }];
            (service as any)._cachedChats = [...mockChats];
            (service as any)._cachePopulated.set(true);
            (service as any)._chatsState.set({ status: 'success', data: [...mockChats] });

            service.loadChats().subscribe();
            tick();

            expect(service.chats()).toEqual(mockChats);
            httpMock.expectNone(CHAT_API.listChats.path);
        }));

        it('should fetch chats from API, update cache, and chatsState if cache is not populated', fakeAsync(() => {
            const mockApiChatList: Static<typeof ChatListSchema> = {
                chats: [{ id: '1', title: 'API Chat', updatedAt: Date.now(), userId: 'u1', shareable: false, parentId: null, rootId: null } as Static<typeof ChatPreviewSchema>],
                hasMore: false,
            };
            const expectedUIChats: UIChat[] = mockApiChatList.chats.map(preview => ({
                id: preview.id,
                title: preview.title,
                updatedAt: preview.updatedAt,
                userId: preview.userId,
                shareable: preview.shareable,
                parentId: preview.parentId,
                rootId: preview.rootId,
                // messages will be undefined as they are not in ChatPreviewSchema
            }));
            (service as any)._cachedChats = null;
            (service as any)._cachePopulated.set(false);
            (service as any)._chatsState.set({ status: 'idle' });

            service.loadChats().subscribe();
            const req = httpMock.expectOne(CHAT_API.listChats.path);
            expect(req.request.method).toBe('GET');
            req.flush(mockApiChatList);
            tick();

            expect(service.chats()).toEqual(expectedUIChats);
            expect((service as any)._cachedChats).toEqual(expectedUIChats);
            expect((service as any)._cachePopulated()).toBe(true);
            expect(service.chatsState().status).toBe('success');
        }));

        it('should handle API error and set error state', fakeAsync(() => {
            (service as any)._cachedChats = null;
            (service as any)._cachePopulated.set(false);
            (service as any)._chatsState.set({ status: 'idle' });

            service.loadChats().subscribe({
                // Subscription is important to trigger the observable chain
            });
            const req = httpMock.expectOne(CHAT_API.listChats.path);
            req.flush('Error loading chats', { status: 500, statusText: 'Server Error' });
            tick();
            
            const state = service.chatsState();
            expect(state.status).toBe('error');
            if (state.status === 'error') {
                expect(state.error).toBeTruthy();
                expect(state.code).toBe(500);
            } else {
                fail('State should be error');
            }
            expect(service.chats()).toBeNull(); // chats computed signal returns null on error
        }));

        it('should return EMPTY and not call API if chatsState is already loading', fakeAsync(() => {
            (service as any)._chatsState.set({ status: 'loading' });
            let hasCompleted = false;
            service.loadChats().subscribe({ complete: () => { hasCompleted = true; } });
            tick();
            expect(hasCompleted).toBe(true); // EMPTY completes immediately
            httpMock.expectNone(CHAT_API.listChats.path);
        }));
    });

    describe('forceReloadChats', () => {
        it('should clear cache, fetch from API, and update state even if cache was populated', fakeAsync(() => {
            const initialCachedChats: UIChat[] = [{ id: 'c1', title: 'Cached', updatedAt: Date.now(), messages: [] }];
            (service as any)._cachedChats = [...initialCachedChats];
            (service as any)._cachePopulated.set(true);
            (service as any)._chatsState.set({ status: 'success', data: [...initialCachedChats] });

            const mockApiChatList: Static<typeof ChatListSchema> = {
                chats: [{ id: 'n1', title: 'New API Chat', updatedAt: Date.now(), userId: 'u1', shareable: false, parentId: null, rootId: null } as Static<typeof ChatPreviewSchema>],
                hasMore: false,
            };
            const expectedUIChats: UIChat[] = mockApiChatList.chats.map(preview => ({
                id: preview.id,
                title: preview.title,
                updatedAt: preview.updatedAt,
                userId: preview.userId,
                shareable: preview.shareable,
                parentId: preview.parentId,
                rootId: preview.rootId,
            }));

            service.forceReloadChats().subscribe();
            const req = httpMock.expectOne(CHAT_API.listChats.path);
            expect(req.request.method).toBe('GET');
            req.flush(mockApiChatList);
            tick();

            expect(service.chats()).toEqual(expectedUIChats);
            expect((service as any)._cachedChats).toEqual(expectedUIChats);
            expect((service as any)._cachePopulated()).toBe(true);
            expect(service.chatsState().status).toBe('success');
        }));

        it('should handle API error, set error state, and clear cache', fakeAsync(() => {
            (service as any)._chatsState.set({ status: 'idle' }); // Ensure not loading

            service.forceReloadChats().subscribe({
                // Subscription is important
            });
            const req = httpMock.expectOne(CHAT_API.listChats.path);
            req.flush('Error forcing reload', { status: 500, statusText: 'Server Error' });
            tick();
            
            const state = service.chatsState();
            expect(state.status).toBe('error');
            if (state.status === 'error') {
                expect(state.error).toBeTruthy();
            } else {
                fail('State should be error');
            }
            expect((service as any)._cachedChats).toBeNull();
            expect((service as any)._cachePopulated()).toBe(false);
        }));
    });

    describe('createChat', () => {
        const userContent: UserContentExt = 'Hello, new chat!';
        const llmId = 'llm-test';
        const expectedPath = CHAT_API.createChat.path;
        const mockApiResponse = createMockApiChatModel('newChatId', 'New Chat Title', [
            createMockApiLlmMessage('msg1', 'user', userContent),
            createMockApiLlmMessage('msg2', 'assistant', 'Response to new chat'),
        ]);

        it('should POST to create a new chat with autoReformat: false when autoReformat is undefined', fakeAsync(() => {
            const mockRequestPayload: Static<typeof ChatMessageSendSchema> = { llmId, userContent, options: undefined, autoReformat: false };
            service.createChat(userContent, llmId, undefined, undefined).subscribe(); // autoReformat is undefined

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.createChat.method);
            expect(req.request.body).toEqual(mockRequestPayload);
            req.flush(mockApiResponse);
            tick();

            const chatSignalAfter = service.chat();
            expect(chatSignalAfter).toBeTruthy();
            expect(chatSignalAfter?.id).toBe('newChatId');
        }));

        it('should POST to create a new chat with autoReformat: true when autoReformat is true', fakeAsync(() => {
            const mockRequestPayload: Static<typeof ChatMessageSendSchema> = { llmId, userContent, options: undefined, autoReformat: true };
            service.createChat(userContent, llmId, undefined, true).subscribe(); // autoReformat is true

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.createChat.method);
            expect(req.request.body).toEqual(mockRequestPayload);
            req.flush(mockApiResponse);
            tick();
        }));

        it('should POST to create a new chat with autoReformat: false when autoReformat is false', fakeAsync(() => {
            const mockRequestPayload: Static<typeof ChatMessageSendSchema> = { llmId, userContent, options: undefined, autoReformat: false };
            service.createChat(userContent, llmId, undefined, false).subscribe(); // autoReformat is false

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.createChat.method);
            expect(req.request.body).toEqual(mockRequestPayload);
            req.flush(mockApiResponse);
            tick();
        }));


        it('should update signals after creating a chat', fakeAsync(() => {
            // This test focuses on signal updates, assuming payload is tested above
            service.createChat(userContent, llmId).subscribe();
            const req = httpMock.expectOne(expectedPath);
            req.flush(mockApiResponse); // Use the predefined mockApiResponse
            tick();

            const chatSignalState = service.chatState();
            expect(chatSignalState.status === 'success' && chatSignalState.data.id === 'newChatId').toBeTrue();
            if (chatSignalState.status === 'success') {
                expect(chatSignalState.data.messages.length).toBe(2);
            }


            const chatsSignal = service.chats();
            expect(chatsSignal?.find(c => c.id === 'newChatId')).toBeTruthy();
        }));
    });

    describe('deleteChat', () => {
        it('should DELETE a chat and update signals', fakeAsync(() => {
            const chatIdToDelete = 'chat1';
            // Set initial state for _chatsState and _chatState
            const initialChats: UIChat[] = [{ id: 'chat1', title: 'Chat 1', updatedAt: Date.now(), messages: [] }, { id: 'chat2', title: 'Chat 2', updatedAt: Date.now(), messages: [] }];
            (service as any)._chatsState.set({ status: 'success', data: initialChats });
            (service as any)._chatState.set({ status: 'success', data: initialChats[0] });


            service.deleteChat(chatIdToDelete).subscribe();

            const req = httpMock.expectOne(CHAT_API.deleteChat.buildPath({ chatId: chatIdToDelete }));
            expect(req.request.method).toBe(CHAT_API.deleteChat.method);
            req.flush(null, { status: 204, statusText: 'No Content' });
            tick();

            const chatsSignal = service.chats();
            expect(chatsSignal?.find(c => c.id === chatIdToDelete)).toBeUndefined();
            expect(chatsSignal?.length).toBe(1);

            const chatState = service.chatState();
            expect(chatState.status).toBe('idle'); // Active chat was deleted, state becomes idle
        }));
    });

    describe('loadChatById', () => {
        it('should fetch a chat by ID and update signals', fakeAsync(() => {
            const chatId = 'chat1';
            const mockApiResponse = createMockApiChatModel(chatId, 'Chat One Details', [
                 createMockApiLlmMessage('msg1', 'user', 'Hello'),
            ]);
            const expectedPath = CHAT_API.getById.buildPath({ chatId });
            // Set initial state for _chatsState
            (service as any)._chatsState.set({ status: 'success', data: [{ id: 'chat1', title: 'Old Title', updatedAt: Date.now(), messages: [] }] });


            service.loadChatById(chatId).subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.getById.method);
            req.flush(mockApiResponse);
            tick();

            const chatState = service.chatState();
            expect(chatState.status === 'success').toBeTrue();
            if (chatState.status === 'success') {
                expect(chatState.data.id).toBe(chatId);
                expect(chatState.data.title).toBe('Chat One Details');
                expect(chatState.data.messages.length).toBe(1);
            }

            const chatsSignal = service.chats();
            const updatedChatInList = chatsSignal?.find(c => c.id === chatId);
            expect(updatedChatInList?.title).toBe('Chat One Details'); // Check if list also updated
        }));

        it('should set a new chat template if ID is NEW_CHAT_ID', fakeAsync(() => {
            const newChatId = 'NEW_CHAT_ID_CONSTANT_VALUE' as typeof NEW_CHAT_ID; // Use actual constant if available
            service.loadChatById(newChatId).subscribe();
            tick();

            const chatState = service.chatState();
            expect(chatState.status === 'success').toBeTrue();
            if (chatState.status === 'success') {
                expect(chatState.data.id).toBe(newChatId);
                expect(chatState.data.messages.length).toBe(0);
            }
            httpMock.expectNone(CHAT_API.getById.buildPath({ chatId: newChatId }));
        }));

        it('should handle errors when loading chat by ID', fakeAsync(() => {
            const chatId = 'nonExistentChat';
            const expectedPath = CHAT_API.getById.buildPath({ chatId });
            service.loadChatById(chatId).subscribe({
                // Error is handled internally and re-thrown, component might subscribe to error
            });
            const req = httpMock.expectOne(expectedPath);
            req.flush('Error', { status: 404, statusText: 'Not Found' });
            tick();
            expect(service.chatState().status).toBe('not_found');
        }));
    });

    describe('updateChatDetails', () => {
        it('should PATCH chat details and update signals', fakeAsync(() => {
            const chatId = 'chat1';
            const updatedProps: Partial<Pick<UIChat, 'title' | 'shareable'>> = { title: 'Updated Title', shareable: true };
            const mockApiResponse = { ...createMockApiChatModel(chatId, 'Old Title'), ...updatedProps, updatedAt: Date.now() };
            const expectedPath = CHAT_API.updateDetails.buildPath({ chatId });

            // Set initial state for _chatsState and _chatState
            const initialChatData: UIChat = { id: 'chat1', title: 'Old Title', shareable: false, updatedAt: Date.now() - 1000, messages: [] };
            (service as any)._chatsState.set({ status: 'success', data: [initialChatData] });
            (service as any)._chatState.set({ status: 'success', data: initialChatData });


            service.updateChatDetails(chatId, updatedProps).subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.updateDetails.method);
            expect(req.request.body).toEqual(updatedProps);
            req.flush(mockApiResponse);
            tick();

            const chatState = service.chatState();
            if (chatState.status === 'success') {
                expect(chatState.data.title).toBe(updatedProps.title);
                expect(chatState.data.shareable).toBe(updatedProps.shareable);
            } else {
                fail('Chat state should be success');
            }

            const chatsSignal = service.chats();
            const updatedChatInList = chatsSignal?.find(c => c.id === chatId);
            expect(updatedChatInList?.title).toBe(updatedProps.title);
        }));
    });

    describe('sendMessage', () => {
        const chatId = 'chat1';
        const userContent: UserContentExt = 'User message';
        const llmId = 'llm-test';
        const mockApiAiResponse = createMockApiLlmMessage('aiMsgId', 'assistant', 'AI response');
        const expectedPath = CHAT_API.sendMessage.buildPath({ chatId });

        beforeEach(() => {
            const initialChat: UIChat = {
                id: chatId,
                title: 'Test Chat',
                messages: [],
                updatedAt: Date.now(),
            };
            // Set initial state for _chatState and _chatsState
            (service as any)._chatState.set({ status: 'success', data: initialChat });
            (service as any)._chatsState.set({ status: 'success', data: [initialChat] });
        });

        it('should POST a message with autoReformat: false when autoReformat is undefined', fakeAsync(() => {
            service.sendMessage(chatId, userContent, llmId, undefined, undefined, undefined).subscribe(); // autoReformat undefined

            tick(); // Allow optimistic update to process

            // Optimistic update check
            let chatState = service.chatState();
            if (chatState.status === 'success') {
                expect(chatState.data.messages.length).toBe(1);
                expect(chatState.data.messages[0].textContent).toBe('User message');
            } else {
                fail('Chat state should be success for optimistic update');
            }


            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.sendMessage.method);
            expect(req.request.body).toEqual({ llmId, userContent, options: undefined, autoReformat: false });
            req.flush(mockApiAiResponse);
            tick();

            // Check AI response
            chatState = service.chatState();
            if (chatState.status === 'success') {
                expect(chatState.data.messages.length).toBe(2); // User + AI
                expect(chatState.data.messages.find(m => !m.isMine)?.textContent).toBe('AI response');
            } else {
                fail('Chat state should be success after AI response');
            }
        }));

        it('should POST a message with autoReformat: true when autoReformat is true', fakeAsync(() => {
            service.sendMessage(chatId, userContent, llmId, undefined, undefined, true).subscribe(); // autoReformat true

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.sendMessage.method);
            expect(req.request.body).toEqual({ llmId, userContent, options: undefined, autoReformat: true });
            req.flush(mockApiAiResponse);
            tick();
        }));

        it('should POST a message with autoReformat: false when autoReformat is false', fakeAsync(() => {
            service.sendMessage(chatId, userContent, llmId, undefined, undefined, false).subscribe(); // autoReformat false

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.sendMessage.method);
            expect(req.request.body).toEqual({ llmId, userContent, options: undefined, autoReformat: false });
            req.flush(mockApiAiResponse);
            tick();
        }));


        it('should update chat optimistically, then with API response, and update list timestamp', fakeAsync(() => {
            // This test focuses on signal updates and list timestamp, assuming payload is tested above
            const initialTime = (service.chatState() as any).data.updatedAt; // Get initial timestamp
            service.sendMessage(chatId, userContent, llmId).subscribe();
            tick(); // optimistic update

            // Optimistic update
            let chatState = service.chatState();
            if (chatState.status === 'success') {
                expect(chatState.data.messages.length).toBe(1);
                expect(chatState.data.messages[0].isMine).toBeTrue();
                expect(chatState.data.messages[0].textContent).toBe('User message');
            } else {
                fail('Chat state should be success');
            }


            const req = httpMock.expectOne(expectedPath);
            req.flush(mockApiAiResponse);
            tick(); // Allow microtasks (like signal updates in tap) to complete

            // Update with AI response
            chatState = service.chatState();
            if (chatState.status === 'success') {
                expect(chatState.data.messages.length).toBe(2); // User message + AI message
                const aiMessageInChat = chatState.data.messages.find(m => !m.isMine);
                expect(aiMessageInChat).toBeTruthy();
                expect(aiMessageInChat?.textContent).toBe('AI response'); // Assuming convertMessage extracts text correctly
            } else {
                fail('Chat state should be success');
            }


            const chatsSignal = service.chats();
            const updatedChatInList = chatsSignal?.find(c => c.id === chatId);
            expect(updatedChatInList?.updatedAt).toBeGreaterThan(initialTime); // Check against initial time
            expect(updatedChatInList?.updatedAt).toBeGreaterThanOrEqual(mockApiAiResponse.stats!.requestTime);
        }));
    });

    describe('regenerateMessage', () => {
        it('should POST to regenerate a message and update chat', fakeAsync(() => {
            const chatId = 'chat1';
            const userContentForRegen: UserContentExt = 'Original user prompt'; // This is the content of the message to regenerate *from*
            const llmId = 'llm-test';
            const historyTruncateIndex = 1; // Example: regenerate after the first message
            const mockApiAiResponse = createMockApiLlmMessage('newAiMsgId', 'assistant', 'New AI response');
            const expectedPath = CHAT_API.regenerateMessage.buildPath({ chatId });

            const initialMessages: ChatMessage[] = [
                { id: 'userMsg1', content: userContentForRegen, textContent: 'Original user prompt', isMine: true, createdAt: new Date().toISOString() },
                { id: 'aiMsg1', content: 'Old AI response', textContent: 'Old AI response', isMine: false, createdAt: new Date().toISOString() },
            ];
            const initialChat: UIChat = { id: chatId, title: 'Test Chat', messages: initialMessages, updatedAt: Date.now() };
            (service as any)._chatState.set({ status: 'success', data: initialChat });
            (service as any)._chatsState.set({ status: 'success', data: [initialChat] });


            service.regenerateMessage(chatId, userContentForRegen, llmId, historyTruncateIndex).subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.regenerateMessage.method);
            expect(req.request.body).toEqual({ userContent: userContentForRegen, llmId, historyTruncateIndex, options: undefined });
            req.flush(mockApiAiResponse);
            tick();

            const chatState = service.chatState();
            if (chatState.status === 'success') {
                expect(chatState.data.messages.length).toBe(historyTruncateIndex + 1); // Messages up to truncateIndex + new AI message
                expect(chatState.data.messages[historyTruncateIndex].textContent).toBe('New AI response');
            } else {
                fail('Chat state should be success');
            }
        }));
    });

    describe('sendAudioMessage', () => {
        it('should prepare audio payload, POST message, and update chat', fakeAsync(() => {
            const chatId = 'chat1';
            const llmId = 'llm-test';
            const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
            const mockApiAiResponse = createMockApiLlmMessage('aiAudioRespId', 'assistant', 'Response to audio');
            const expectedPath = CHAT_API.sendMessage.buildPath({ chatId }); // Uses the same endpoint

            const initialChat: UIChat = { id: chatId, title: 'Test Chat', messages: [], updatedAt: Date.now() };
            (service as any)._chatState.set({ status: 'success', data: initialChat });


            service.sendAudioMessage(chatId, llmId, audioBlob).subscribe();
            tick(); // For prepareUserContentPayload promise & optimistic update

            // Optimistic update (placeholder)
            let chatState = service.chatState();
            if (chatState.status === 'success') {
                expect(chatState.data.messages.length).toBe(1);
                expect(chatState.data.messages[0].textContent).toBe('Audio message sent...');
            } else {
                fail('Chat state should be success for optimistic audio update');
            }


            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.sendMessage.method);
            // Body will be complex due to base64 encoding, check for key parts if necessary
            expect(req.request.body.llmId).toBe(llmId);
            expect(Array.isArray(req.request.body.userContent)).toBeTrue();
            expect(req.request.body.userContent[0].type).toBe('file'); // Audio is sent as a file part
            expect(req.request.body.userContent[0].filename).toBe('audio.webm');

            req.flush(mockApiAiResponse);
            tick();

            chatState = service.chatState();
            if (chatState.status === 'success') {
                expect(chatState.data.messages.length).toBe(1); // Placeholder replaced by AI response
                expect(chatState.data.messages[0].textContent).toBe('Response to audio');
            } else {
                fail('Chat state should be success after audio response');
            }
        }));
    });

    describe('formatMessageAsMarkdown', () => {
        it('should POST text and return formatted markdown', fakeAsync(() => {
            const textToFormat = '## Hello';
            const mockApiResponse: Static<typeof ChatMarkdownResponseSchema> = { markdownText: '<h2>Hello</h2>' };
            const expectedPath = CHAT_API.formatAsMarkdown.path;
            let resultMarkdown = '';

            service.formatMessageAsMarkdown(textToFormat).subscribe(markdown => {
                resultMarkdown = markdown;
            });

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.formatAsMarkdown.method);
            expect(req.request.body).toEqual({ text: textToFormat });
            req.flush(mockApiResponse);
            tick();

            expect(resultMarkdown).toBe(mockApiResponse.markdownText);
        }));

        it('should handle errors when formatting markdown', fakeAsync(() => {
            const textToFormat = '## Hello';
            const expectedPath = CHAT_API.formatAsMarkdown.path;
            let caughtError: Error | null = null;
            service.formatMessageAsMarkdown(textToFormat).subscribe({
                next: () => fail('should have failed'),
                error: (err) => {
                    caughtError = err;
                },
            });
            const req = httpMock.expectOne(expectedPath);
            req.flush('Error', { status: 500, statusText: 'Server Error' });
            tick();
            expect(caughtError).toBeTruthy();
            expect(caughtError?.message).toContain('Failed to format message as Markdown.');
        }));
    });

    describe('setChat', () => {
        it('should update the _chatState signal directly', () => {
            const testChat: UIChat = { id: 'testSetChat', title: 'Set Chat', messages: [], updatedAt: Date.now() };
            service.setChat(testChat);
            const chatState = service.chatState();
            expect(chatState.status === 'success' && chatState.data).toEqual(testChat);

            service.setChat(null);
            expect(service.chatState().status).toBe('idle');
        });
    });

    describe('resetChat', () => {
        it('should set the _chatState signal to idle', () => {
            const testChat: UIChat = { id: 'testResetChat', title: 'Reset Chat', messages: [], updatedAt: Date.now() };
            (service as any)._chatState.set({ status: 'success', data: testChat }); // Set some initial value
            
            let chatState = service.chatState();
            expect(chatState.status === 'success' && chatState.data).toEqual(testChat);

            service.resetChat();
            expect(service.chatState().status).toBe('idle');
        });
    });
    
    describe('cache updates on CRUD operations', () => {
        it('deleteChat should remove chat from _cachedChats and _chatsState.data', fakeAsync(() => {
            const chatToDeleteId = 'chat1';
            const initialChats: UIChat[] = [
                { id: chatToDeleteId, title: 'To Delete', updatedAt: Date.now(), messages: [] },
                { id: 'chat2', title: 'To Keep', updatedAt: Date.now(), messages: [] }
            ];
            (service as any)._cachedChats = [...initialChats];
            (service as any)._chatsState.set({ status: 'success', data: [...initialChats] });

            service.deleteChat(chatToDeleteId).subscribe(() => {});
            
            const req = httpMock.expectOne(CHAT_API.deleteChat.buildPath({ chatId: chatToDeleteId }));
            req.flush(null, { status: 204, statusText: 'No Content' });
            tick();

            expect((service as any)._cachedChats?.find((c: UIChat) => c.id === chatToDeleteId)).toBeUndefined();
            expect(service.chats()?.find(c => c.id === chatToDeleteId)).toBeUndefined();
            expect(service.chats()?.length).toBe(1);
        }));

        it('sendMessage should update updatedAt and reorder chat in _cachedChats and _chatsState.data', fakeAsync(() => {
            const chatIdToUpdate = 'chat2';
            const initialTime = Date.now() - 10000;
            const chats: UIChat[] = [
                { id: 'chat1', title: 'Chat 1', updatedAt: initialTime - 1000, messages: [] },
                { id: chatIdToUpdate, title: 'Chat 2', updatedAt: initialTime, messages: [] }
            ];
            (service as any)._cachedChats = [...chats];
            (service as any)._chatsState.set({ status: 'success', data: [...chats] });
            (service as any)._chatState.set({ status: 'success', data: chats.find(c => c.id === chatIdToUpdate) || chats[0] });


            const mockApiAiResponse = createMockApiLlmMessage('aiMsgId', 'assistant', 'AI response', Date.now());

            service.sendMessage(chatIdToUpdate, 'User message', 'llm1').subscribe(() => {});
            tick(); // optimistic update

            const req = httpMock.expectOne(CHAT_API.sendMessage.buildPath({ chatId: chatIdToUpdate }));
            req.flush(mockApiAiResponse);
            tick(); // API response processing

            const updatedChats = service.chats();
            const updatedCachedChats = (service as any)._cachedChats;

            expect(updatedChats?.[0].id).toBe(chatIdToUpdate);
            expect(updatedChats?.[0].updatedAt).toBeGreaterThan(initialTime);
            expect(updatedCachedChats?.[0].id).toBe(chatIdToUpdate);
            expect(updatedCachedChats?.[0].updatedAt).toBeGreaterThan(initialTime);
        }));
    });


    // Test for convertMessage utility function (if exported or tested via service methods)
    // This is implicitly tested by methods like loadChatById, sendMessage, etc.
    // but a direct test can be useful if its logic is complex.
    describe('convertMessage (internal utility via service methods)', () => {
        it('should convert API LLM message to UI ChatMessage correctly (string content)', () => {
            const apiMsg: Static<typeof LlmMessageSchema> = createMockApiLlmMessage('msg1', 'assistant', 'Hello text');
            const uiMsg = convertMessage(apiMsg); // Assuming convertMessage is exported for testing or test via service
            expect(uiMsg.id).toBeDefined();
            expect(uiMsg.isMine).toBeFalse();
            expect(uiMsg.textContent).toBe('Hello text');
            expect(uiMsg.content).toBe('Hello text'); // ChatMessage.content is UserContentExt
            expect(uiMsg.stats).toEqual(apiMsg.stats);
        });

        it('should convert API LLM message with array content (text part)', () => {
            const apiMsg: Static<typeof LlmMessageSchema> = createMockApiLlmMessage('msg2', 'user', [{ type: 'text', text: 'User input' }]);
            const uiMsg = convertMessage(apiMsg);
            expect(uiMsg.isMine).toBeTrue();
            expect(uiMsg.textContent).toBe('User input');
            expect(uiMsg.content).toEqual([{ type: 'text', text: 'User input' }]);
        });

        it('should convert API LLM message with image part (mocked filename/size)', () => {
            const apiImagePart: import('ai').ImagePart = { type: 'image', image: 'base64data', mimeType: 'image/png' };
            // Simulate backend adding filename/size, as convertMessage expects them via `(apiImgPart as any)`
            (apiImagePart as any).filename = 'test.png';
            (apiImagePart as any).size = 1024;

            const apiMsg: Static<typeof LlmMessageSchema> = createMockApiLlmMessage('msg3', 'assistant', [apiImagePart]);
            const uiMsg = convertMessage(apiMsg);

            const { text: derivedText, attachments } = userContentExtToAttachmentsAndText(uiMsg.content as UserContentExt);
            expect(derivedText).toBe(''); // Or placeholder if defined
            expect(attachments.length).toBe(1);
            expect(attachments[0].type).toBe('image');
            expect(attachments[0].filename).toBe('test.png');
            expect(uiMsg.imageAttachments.length).toBe(1);
            expect(uiMsg.imageAttachments[0].filename).toBe('test.png');
        });
    });
});
