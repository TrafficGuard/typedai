import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ChatServiceClient } from './chat.service';
import { CHAT_API } from '#shared/api/chat.api';
import type { Chat, ChatMessage, NEW_CHAT_ID } from 'app/modules/chat/chat.types';
import type { UserContentExt } from '#shared/model/llm.model';
import type { Static } from '@sinclair/typebox';
import {
    ChatListSchema,
    ChatMarkdownRequestSchema,
    ChatMarkdownResponseSchema,
    ChatMessageSendSchema,
    ChatModelSchema,
    ChatUpdateDetailsSchema,
    RegenerateMessageSchema,
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
        it('should fetch chats and update signals if not already loaded', fakeAsync(() => {
            const mockApiChatList: Static<typeof ChatListSchema> = {
                chats: [
                    { id: 'chat1', userId: 'user-test-id', shareable: false, title: 'Chat One', updatedAt: mockApiChat1.updatedAt },
                    { id: 'chat2', userId: 'user-test-id', shareable: false, title: 'Chat Two', updatedAt: mockApiChat2.updatedAt },
                ],
                hasMore: false,
            };
            const expectedPath = CHAT_API.listChats.path;

            service.loadChats().subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.listChats.method);
            req.flush(mockApiChatList);
            tick();

            const chatsSignal = service.chats();
            expect(chatsSignal).toBeTruthy();
            expect(chatsSignal?.length).toBe(2);
            expect(chatsSignal?.[0].id).toBe('chat1');
            expect(chatsSignal?.[1].id).toBe('chat2');
            expect(service['_chatsLoaded']()).toBeTrue();
        }));

        it('should return immediately if chats are already loaded', fakeAsync(() => {
            service['_chatsLoaded'].set(true); // Simulate chats already loaded
            service.loadChats().subscribe();
            tick();
            // No HTTP call should be made
            expect(httpMock.expectNone(CHAT_API.listChats.path)).toBeUndefined();
        }));

        it('should handle errors when loading chats', fakeAsync(() => {
            const expectedPath = CHAT_API.listChats.path;
            service.loadChats().subscribe({
                next: () => fail('should have failed'),
                error: (err) => {
                    expect(err).toBeTruthy();
                },
            });
            const req = httpMock.expectOne(expectedPath);
            req.flush('Error', { status: 500, statusText: 'Server Error' });
            tick();

            expect(service.chats()).toBeNull();
            expect(service['_chatsLoaded']()).toBeFalse();
        }));
    });

    describe('createChat', () => {
        it('should POST to create a new chat and update signals', fakeAsync(() => {
            const userContent: UserContentExt = 'Hello, new chat!';
            const llmId = 'llm-test';
            const mockRequestPayload: Static<typeof ChatMessageSendSchema> = { llmId, userContent, options: undefined };
            const mockApiResponse = createMockApiChatModel('newChatId', 'New Chat Title', [
                createMockApiLlmMessage('msg1', 'user', userContent),
                createMockApiLlmMessage('msg2', 'assistant', 'Response to new chat'),
            ]);
            const expectedPath = CHAT_API.createChat.path;

            service.createChat(userContent, llmId).subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.createChat.method);
            expect(req.request.body).toEqual(mockRequestPayload);
            req.flush(mockApiResponse);
            tick();

            const chatSignalAfter = service.chat();
            expect(chatSignalAfter).toBeTruthy();
            expect(chatSignalAfter?.id).toBe('newChatId');
            expect(chatSignalAfter?.messages.length).toBe(2);

            const chatsSignal = service.chats();
            expect(chatsSignal?.find(c => c.id === 'newChatId')).toBeTruthy();
            const chatSignal = service.chat();
            expect(chatSignal?.id).toBe('newChatId');
        }));
    });

    describe('deleteChat', () => {
        it('should DELETE a chat and update signals', fakeAsync(() => {
            const chatIdToDelete = 'chat1';
            service['_chats'].set([{ id: 'chat1' } as Chat, { id: 'chat2' } as Chat]);
            service['_chat'].set({ id: 'chat1' } as Chat);
            const expectedPath = CHAT_API.deleteChat.buildPath({ chatId: chatIdToDelete });

            service.deleteChat(chatIdToDelete).subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.deleteChat.method);
            req.flush(null, { status: 204, statusText: 'No Content' });
            tick();

            const chatsSignal = service.chats();
            expect(chatsSignal?.find(c => c.id === chatIdToDelete)).toBeUndefined();
            expect(chatsSignal?.length).toBe(1);
            const chatSignal = service.chat();
            expect(chatSignal).toBeNull(); // Active chat was deleted
        }));
    });

    describe('loadChatById', () => {
        it('should fetch a chat by ID and update signals', fakeAsync(() => {
            const chatId = 'chat1';
            const mockApiResponse = createMockApiChatModel(chatId, 'Chat One Details', [
                 createMockApiLlmMessage('msg1', 'user', 'Hello'),
            ]);
            const expectedPath = CHAT_API.getById.buildPath({ chatId });
            service['_chats'].set([{ id: 'chat1', title: 'Old Title' } as Chat]);


            service.loadChatById(chatId).subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.getById.method);
            req.flush(mockApiResponse);
            tick();

            const chatSignal = service.chat();
            expect(chatSignal).toBeTruthy();
            expect(chatSignal?.id).toBe(chatId);
            expect(chatSignal?.title).toBe('Chat One Details');
            expect(chatSignal?.messages.length).toBe(1);

            const chatsSignal = service.chats();
            const updatedChatInList = chatsSignal?.find(c => c.id === chatId);
            expect(updatedChatInList?.title).toBe('Chat One Details'); // Check if list also updated
        }));

        it('should set a new chat template if ID is NEW_CHAT_ID', fakeAsync(() => {
            const newChatId = 'NEW_CHAT_ID_CONSTANT_VALUE' as typeof NEW_CHAT_ID; // Use actual constant if available
            service.loadChatById(newChatId).subscribe();
            tick();

            const chatSignal = service.chat();
            expect(chatSignal).toBeTruthy();
            expect(chatSignal?.id).toBe(newChatId);
            expect(chatSignal?.messages.length).toBe(0);
            httpMock.expectNone(CHAT_API.getById.buildPath({ chatId: newChatId }));
        }));

        it('should handle errors when loading chat by ID', fakeAsync(() => {
            const chatId = 'nonExistentChat';
            const expectedPath = CHAT_API.getById.buildPath({ chatId });
            service.loadChatById(chatId).subscribe({
                next: () => fail('should have failed'),
                error: (err) => {
                    expect(err).toBeTruthy();
                },
            });
            const req = httpMock.expectOne(expectedPath);
            req.flush('Error', { status: 404, statusText: 'Not Found' });
            tick();
            expect(service.chat()).toBeNull();
        }));
    });

    describe('updateChatDetails', () => {
        it('should PATCH chat details and update signals', fakeAsync(() => {
            const chatId = 'chat1';
            const updatedProps: Partial<Pick<Chat, 'title' | 'shareable'>> = { title: 'Updated Title', shareable: true };
            const mockApiResponse = { ...createMockApiChatModel(chatId, 'Old Title'), ...updatedProps, updatedAt: Date.now() };
            const expectedPath = CHAT_API.updateDetails.buildPath({ chatId });

            service['_chats'].set([{ id: 'chat1', title: 'Old Title', shareable: false } as Chat]);
            service['_chat'].set({ id: 'chat1', title: 'Old Title', shareable: false } as Chat);

            service.updateChatDetails(chatId, updatedProps).subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.updateDetails.method);
            expect(req.request.body).toEqual(updatedProps);
            req.flush(mockApiResponse);
            tick();

            const chatSignal = service.chat();
            expect(chatSignal?.title).toBe(updatedProps.title);
            expect(chatSignal?.shareable).toBe(updatedProps.shareable);

            const chatsSignal = service.chats();
            const updatedChatInList = chatsSignal?.find(c => c.id === chatId);
            expect(updatedChatInList?.title).toBe(updatedProps.title);
        }));
    });

    describe('sendMessage', () => {
        it('should POST a message, update chat optimistically, then with API response', fakeAsync(() => {
            const chatId = 'chat1';
            const userContent: UserContentExt = 'User message';
            const llmId = 'llm-test';
            const mockApiAiResponse = createMockApiLlmMessage('aiMsgId', 'assistant', 'AI response');
            const expectedPath = CHAT_API.sendMessage.buildPath({ chatId });

            const initialChat: Chat = {
                id: chatId,
                title: 'Test Chat',
                messages: [],
                updatedAt: Date.now(),
            };
            service['_chat'].set(initialChat);
            service['_chats'].set([initialChat]);


            service.sendMessage(chatId, userContent, llmId).subscribe();

            // Optimistic update
            let chatSignal = service.chat();
            expect(chatSignal?.messages.length).toBe(1);
            expect(chatSignal?.messages[0].isMine).toBeTrue();
            expect(chatSignal?.messages[0].textContent).toBe('User message');

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.sendMessage.method);
            expect(req.request.body).toEqual({ llmId, userContent, options: undefined });
            req.flush(mockApiAiResponse);
            tick(); // Allow microtasks (like signal updates in tap) to complete

            // Update with AI response
            chatSignal = service.chat();
            expect(chatSignal?.messages.length).toBe(2); // User message + AI message
            const aiMessageInChat = chatSignal?.messages.find(m => !m.isMine);
            expect(aiMessageInChat).toBeTruthy();
            expect(aiMessageInChat?.textContent).toBe('AI response'); // Assuming convertMessage extracts text correctly

            const chatsSignal = service.chats();
            const updatedChatInList = chatsSignal?.find(c => c.id === chatId);
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
            const initialChat: Chat = { id: chatId, title: 'Test Chat', messages: initialMessages, updatedAt: Date.now() };
            service['_chat'].set(initialChat);
            service['_chats'].set([initialChat]);

            service.regenerateMessage(chatId, userContentForRegen, llmId, historyTruncateIndex).subscribe();

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.regenerateMessage.method);
            expect(req.request.body).toEqual({ userContent: userContentForRegen, llmId, historyTruncateIndex, options: undefined });
            req.flush(mockApiAiResponse);
            tick();

            const chatSignal = service.chat();
            expect(chatSignal?.messages.length).toBe(historyTruncateIndex + 1); // Messages up to truncateIndex + new AI message
            expect(chatSignal?.messages[historyTruncateIndex].textContent).toBe('New AI response');
        }));
    });

    describe('sendAudioMessage', () => {
        it('should prepare audio payload, POST message, and update chat', fakeAsync(() => {
            const chatId = 'chat1';
            const llmId = 'llm-test';
            const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
            const mockApiAiResponse = createMockApiLlmMessage('aiAudioRespId', 'assistant', 'Response to audio');
            const expectedPath = CHAT_API.sendMessage.buildPath({ chatId }); // Uses the same endpoint

            const initialChat: Chat = { id: chatId, title: 'Test Chat', messages: [], updatedAt: Date.now() };
            service['_chat'].set(initialChat);

            service.sendAudioMessage(chatId, llmId, audioBlob).subscribe();
            tick(); // For prepareUserContentPayload promise

            // Optimistic update (placeholder)
            let chatSignal = service.chat();
            expect(chatSignal?.messages.length).toBe(1);
            expect(chatSignal?.messages[0].textContent).toBe('Audio message sent...');

            const req = httpMock.expectOne(expectedPath);
            expect(req.request.method).toBe(CHAT_API.sendMessage.method);
            // Body will be complex due to base64 encoding, check for key parts if necessary
            expect(req.request.body.llmId).toBe(llmId);
            expect(Array.isArray(req.request.body.userContent)).toBeTrue();
            expect(req.request.body.userContent[0].type).toBe('file'); // Audio is sent as a file part
            expect(req.request.body.userContent[0].filename).toBe('audio.webm');

            req.flush(mockApiAiResponse);
            tick();

            chatSignal = service.chat();
            expect(chatSignal?.messages.length).toBe(1); // Placeholder replaced by AI response
            expect(chatSignal?.messages[0].textContent).toBe('Response to audio');
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
        it('should update the _chat signal directly', () => {
            const testChat: Chat = { id: 'testSetChat', title: 'Set Chat', messages: [], updatedAt: Date.now() };
            service.setChat(testChat);
            expect(service.chat()).toEqual(testChat);

            service.setChat(null);
            expect(service.chat()).toBeNull();
        });
    });

    describe('resetChat', () => {
        it('should set the _chat signal to null', () => {
            const testChat: Chat = { id: 'testResetChat', title: 'Reset Chat', messages: [], updatedAt: Date.now() };
            service['_chat'].set(testChat); // Set some initial value
            expect(service.chat()).toEqual(testChat);

            service.resetChat();
            expect(service.chat()).toBeNull();
        });
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
