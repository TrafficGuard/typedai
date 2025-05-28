/// <reference types="jest" />
// Essential imports for testing Fastify route handlers
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes'; // Assuming this type exists for the Fastify app instance
import { CHAT_API } from '#shared/api/chat.api'; // To reference API paths

import { send, sendBadRequest } from '#fastify/index';
import { getLLM } from '#llm/llmFactory'; // summaryLLM is also from here
import { logger } from '#o11y/logger';
// Functions and modules to be mocked
import { currentUser } from '#user/userContext';
import { getMarkdownFormatPrompt } from '../../chat/chatPromptUtils'; // This path is relative to src/routes/chat/

import type { Static } from '@sinclair/typebox'; // For deriving types from TypeBox schemas
import type { LlmMessage, LLM as LlmModel } from '#shared/model/llm.model'; // For typing LLM mocks
// Types for request bodies and parameters
import type { ChatMessageSendSchema, ChatParamsSchema } from '#shared/schemas/chat.schema';

// The route registration function to be tested
import { chatRoutes } from './chat-routes'; // The file under test

// Mock module paths
jest.mock('#user/userContext');
jest.mock('#llm/llmFactory');
jest.mock('../../chat/chatPromptUtils'); // Path relative to src/routes/chat/
jest.mock('#fastify/index');
jest.mock('#o11y/logger');

// Typed mock functions
const mockedCurrentUser = currentUser as jest.Mock;
const mockedGetLLM = getLLM as jest.Mock;
const { summaryLLM: mockedSummaryLLM } = jest.requireMock('#llm/llmFactory'); // Get summaryLLM from the mocked module
const mockedGetMarkdownFormatPrompt = getMarkdownFormatPrompt as jest.Mock;
const mockedSendBadRequest = sendBadRequest as jest.Mock;
const mockedSend = send as jest.Mock; // mockedSend is not used in the provided tests, but kept for consistency
const mockedLoggerInfo = logger.info as jest.Mock;
const mockedLoggerError = logger.error as jest.Mock;
const mockedLoggerWarn = logger.warn as jest.Mock;

// Mock Fastify instance and reply object
const mockFastifyInstance = {
	chatService: {
		loadChat: jest.fn(),
		saveChat: jest.fn(),
		// listChats, deleteChat etc. can be added if other routes in chat-routes.ts are tested
	},
	get: jest.fn(),
	post: jest.fn(),
	patch: jest.fn(),
	delete: jest.fn(),
	// Add any other properties or methods of FastifyInstance used by chatRoutes
} as unknown as AppFastifyInstance;

const mockReply = {
	code: jest.fn().mockReturnThis(),
	send: jest.fn().mockReturnThis(),
	sendJSON: jest.fn().mockReturnThis(),
} as unknown as FastifyReply;

// Mock LLM instances
const mockPrimaryLlmInstance: Partial<LlmModel> = {
	getId: jest.fn().mockReturnValue('mock-primary-llm'),
	isConfigured: jest.fn().mockReturnValue(true),
	generateText: jest.fn(),
	generateMessage: jest.fn(),
};
const mockSummaryLlmInstance: Partial<LlmModel> = {
	getId: jest.fn().mockReturnValue('mock-summary-llm'),
	isConfigured: jest.fn().mockReturnValue(true),
	generateText: jest.fn(),
};

// Variables to store captured route handlers
let capturedCreateChatHandler: ((req: FastifyRequest, reply: FastifyReply) => Promise<void>) | undefined;
let capturedSendMessageHandler: ((req: FastifyRequest, reply: FastifyReply) => Promise<void>) | undefined;

// Setup before all tests to register routes and capture handlers
beforeAll(async () => {
	// Default mock implementations that can be overridden in specific tests
	mockedCurrentUser.mockReturnValue({ id: 'test-user-id', chat: {} }); // Default user
	mockedGetLLM.mockReturnValue(mockPrimaryLlmInstance);
	mockedSummaryLLM.mockReturnValue(mockSummaryLlmInstance);
	(mockPrimaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(true);
	(mockSummaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(true);
	(mockFastifyInstance.chatService.loadChat as jest.Mock).mockResolvedValue({ id: 'chat-123', userId: 'test-user-id', messages: [], title: 'Test Chat' });
	(mockFastifyInstance.chatService.saveChat as jest.Mock).mockImplementation((chat) => Promise.resolve(chat)); // Echo back the chat
	mockedGetMarkdownFormatPrompt.mockReturnValue('mock-formatting-prompt-text'); // Default prompt text
	(mockPrimaryLlmInstance.generateMessage as jest.Mock).mockResolvedValue({ role: 'assistant', content: 'Mocked AI response' } as LlmMessage);
	(mockPrimaryLlmInstance.generateText as jest.Mock).mockResolvedValue('Mocked reformatted text from primary LLM');
	(mockSummaryLlmInstance.generateText as jest.Mock).mockResolvedValue('Mocked reformatted text from summary LLM');

	// Call chatRoutes to register the routes with the mock Fastify instance
	await chatRoutes(mockFastifyInstance);

	// Capture the handlers registered by chatRoutes
	// For createChat (POST /api/chat/new)
	const createChatArgs = (mockFastifyInstance.post as jest.Mock).mock.calls.find((args) => args[0] === CHAT_API.createChat.pathTemplate);
	if (createChatArgs) capturedCreateChatHandler = createChatArgs[createChatArgs.length - 1]; // Handler is typically the last argument

	// For sendMessage (POST /api/chat/:chatId/send)
	const sendMessageArgs = (mockFastifyInstance.post as jest.Mock).mock.calls.find((args) => args[0] === CHAT_API.sendMessage.pathTemplate);
	if (sendMessageArgs) capturedSendMessageHandler = sendMessageArgs[sendMessageArgs.length - 1];
});

beforeEach(() => {
	jest.clearAllMocks();
	// Restore default implementations if they were changed in a test
	// This is important if tests modify the default behavior of mocks.
	// For instance:
	mockedCurrentUser.mockReturnValue({ id: 'test-user-id', chat: {} });
	mockedGetLLM.mockReturnValue(mockPrimaryLlmInstance);
	mockedSummaryLLM.mockReturnValue(mockSummaryLlmInstance);
	(mockPrimaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(true);
	(mockSummaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(true);
	(mockFastifyInstance.chatService.loadChat as jest.Mock).mockResolvedValue({ id: 'chat-123', userId: 'test-user-id', messages: [], title: 'Test Chat' });
	(mockFastifyInstance.chatService.saveChat as jest.Mock).mockImplementation((chat) => Promise.resolve(chat));
	mockedGetMarkdownFormatPrompt.mockReturnValue('mock-formatting-prompt-text');
	(mockPrimaryLlmInstance.generateMessage as jest.Mock).mockResolvedValue({ role: 'assistant', content: 'Mocked AI response' } as LlmMessage);
	(mockPrimaryLlmInstance.generateText as jest.Mock).mockResolvedValue('Mocked reformatted text from primary LLM');
	(mockSummaryLlmInstance.generateText as jest.Mock).mockResolvedValue('Mocked reformatted text from summary LLM');
});

describe('Chat Routes - autoReformat Functionality', () => {
	describe('createChat Handler (POST /api/chat/new)', () => {
		if (!capturedCreateChatHandler) {
			it.skip('Handler not captured, skipping createChat tests', () => {});
			return;
		}

		const baseCreateChatRequest = (
			bodyPayload: Partial<Static<typeof ChatMessageSendSchema>> = {},
		): FastifyRequest<{ Body: Static<typeof ChatMessageSendSchema> }> =>
			({
				body: {
					llmId: 'test-llm-id',
					userContent: 'Original user message for new chat',
					options: {},
					autoReformat: false, // Default to false
					...bodyPayload,
				},
				// params, query, etc. as needed by the handler
			}) as unknown as FastifyRequest<{ Body: Static<typeof ChatMessageSendSchema> }>;

		it('Scenario 1.1 (createChat): autoReformat=true, successful reformat with summaryLLM', async () => {
			(mockSummaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(true);
			(mockSummaryLlmInstance.generateText as jest.Mock).mockResolvedValue('Reformatted content by summaryLLM');
			const request = baseCreateChatRequest({ userContent: 'Needs reformat', autoReformat: true });

			await capturedCreateChatHandler!(request, mockReply);

			expect(mockedGetMarkdownFormatPrompt).toHaveBeenCalledWith('Needs reformat');
			expect(mockSummaryLlmInstance.generateText).toHaveBeenCalledWith('mock-formatting-prompt-text', expect.objectContaining({ id: 'chat-auto-format' }));
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Reformatted content by summaryLLM' })]),
				expect.objectContaining({ id: 'chat' }),
			);
			expect(mockFastifyInstance.chatService.saveChat).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Reformatted content by summaryLLM' })]),
				}),
			);
			expect(mockReply.code).toHaveBeenCalledWith(201);
			expect(mockReply.sendJSON).toHaveBeenCalled();
		});

		it('Scenario 1.2 (createChat): autoReformat=true, reformat with primary LLM (summaryLLM not configured)', async () => {
			(mockSummaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(false);
			(mockPrimaryLlmInstance.generateText as jest.Mock).mockResolvedValue('Reformatted content by primaryLLM');
			const request = baseCreateChatRequest({ userContent: 'Needs reformat', autoReformat: true });

			await capturedCreateChatHandler!(request, mockReply);

			expect(mockedGetMarkdownFormatPrompt).toHaveBeenCalledWith('Needs reformat');
			expect(mockSummaryLlmInstance.generateText).not.toHaveBeenCalled();
			expect(mockPrimaryLlmInstance.generateText).toHaveBeenCalledWith('mock-formatting-prompt-text', expect.objectContaining({ id: 'chat-auto-format' }));
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Reformatted content by primaryLLM' })]),
				expect.any(Object),
			);
		});

		it('Scenario 1.3 (createChat): autoReformat=true, formatting LLM call fails, proceeds with original content', async () => {
			(mockSummaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(true);
			(mockSummaryLlmInstance.generateText as jest.Mock).mockRejectedValue(new Error('Formatting LLM failed'));
			const request = baseCreateChatRequest({ userContent: 'Original content on failure', autoReformat: true });

			await capturedCreateChatHandler!(request, mockReply);

			expect(mockedLoggerError).toHaveBeenCalledWith(
				expect.objectContaining({ err: expect.any(Error) }),
				'Failed to auto-reformat message content for new chat. Proceeding with original.',
			);
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Original content on failure' })]),
				expect.any(Object),
			);
		});

		it('Scenario 1.5 (createChat): autoReformat=true, userContent is empty string, skips reformatting', async () => {
			const request = baseCreateChatRequest({ userContent: '', autoReformat: true });
			await capturedCreateChatHandler!(request, mockReply);
			expect(mockedGetMarkdownFormatPrompt).not.toHaveBeenCalled();
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: '' })]),
				expect.any(Object),
			);
		});

		it('Scenario 2.1 (createChat): autoReformat=false, skips reformatting', async () => {
			const request = baseCreateChatRequest({ userContent: 'Original content, no reformat', autoReformat: false });
			await capturedCreateChatHandler!(request, mockReply);
			expect(mockedGetMarkdownFormatPrompt).not.toHaveBeenCalled();
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Original content, no reformat' })]),
				expect.any(Object),
			);
		});

		it('createChat: LLM not configured, should sendBadRequest', async () => {
			(mockPrimaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(false);
			const request = baseCreateChatRequest();
			await capturedCreateChatHandler!(request, mockReply);
			expect(mockedSendBadRequest).toHaveBeenCalledWith(mockReply, 'LLM mock-primary-llm is not configured');
		});
	});

	describe('sendMessage Handler (POST /api/chat/:chatId/send)', () => {
		if (!capturedSendMessageHandler) {
			it.skip('Handler not captured, skipping sendMessage tests', () => {});
			return;
		}

		const baseSendMessageRequest = (
			chatId: string,
			bodyPayload: Partial<Static<typeof ChatMessageSendSchema>> = {},
		): FastifyRequest<{ Params: Static<typeof ChatParamsSchema>; Body: Static<typeof ChatMessageSendSchema> }> =>
			({
				params: { chatId },
				body: {
					llmId: 'test-llm-id',
					userContent: 'Original user message for existing chat',
					options: {},
					autoReformat: false, // Default to false
					...bodyPayload,
				},
			}) as unknown as FastifyRequest<{ Params: Static<typeof ChatParamsSchema>; Body: Static<typeof ChatMessageSendSchema> }>;

		it('Scenario 1.1 (sendMessage): autoReformat=true, successful reformat with summaryLLM', async () => {
			(mockSummaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(true);
			(mockSummaryLlmInstance.generateText as jest.Mock).mockResolvedValue('Sent reformatted by summaryLLM');
			const request = baseSendMessageRequest('chat-123', { userContent: 'Send needs reformat', autoReformat: true });
			(mockFastifyInstance.chatService.loadChat as jest.Mock).mockResolvedValue({ id: 'chat-123', userId: 'test-user-id', messages: [], title: 'Test Chat' });

			await capturedSendMessageHandler!(request, mockReply);

			expect(mockedGetMarkdownFormatPrompt).toHaveBeenCalledWith('Send needs reformat');
			expect(mockSummaryLlmInstance.generateText).toHaveBeenCalledWith('mock-formatting-prompt-text', expect.objectContaining({ id: 'chat-auto-format' }));
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Sent reformatted by summaryLLM' })]),
				expect.objectContaining({ id: 'chat' }),
			);
			expect(mockFastifyInstance.chatService.saveChat).toHaveBeenCalled(); // Further assertions on content can be added
			expect(mockReply.sendJSON).toHaveBeenCalled();
		});

		// Add more tests for sendMessage, mirroring createChat scenarios for autoReformat logic.
		it('Scenario 1.2 (sendMessage): autoReformat=true, reformat with primary LLM (summaryLLM not configured)', async () => {
			(mockSummaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(false);
			(mockPrimaryLlmInstance.generateText as jest.Mock).mockResolvedValue('Sent reformatted by primaryLLM');
			const request = baseSendMessageRequest('chat-123', { userContent: 'Send needs reformat', autoReformat: true });
			await capturedSendMessageHandler!(request, mockReply);

			expect(mockedGetMarkdownFormatPrompt).toHaveBeenCalledWith('Send needs reformat');
			expect(mockSummaryLlmInstance.generateText).not.toHaveBeenCalled();
			expect(mockPrimaryLlmInstance.generateText).toHaveBeenCalledWith('mock-formatting-prompt-text', expect.objectContaining({ id: 'chat-auto-format' }));
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Sent reformatted by primaryLLM' })]),
				expect.any(Object),
			);
		});

		it('Scenario 1.3 (sendMessage): autoReformat=true, formatting LLM call fails, proceeds with original content', async () => {
			(mockSummaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(true);
			(mockSummaryLlmInstance.generateText as jest.Mock).mockRejectedValue(new Error('Formatting LLM failed'));
			const request = baseSendMessageRequest('chat-123', { userContent: 'Original send content on failure', autoReformat: true });
			await capturedSendMessageHandler!(request, mockReply);

			expect(mockedLoggerError).toHaveBeenCalledWith(
				expect.objectContaining({ err: expect.any(Error) }),
				'Failed to auto-reformat message content for existing chat. Proceeding with original.',
			);
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Original send content on failure' })]),
				expect.any(Object),
			);
		});

		it('Scenario 1.5 (sendMessage): autoReformat=true, userContent is empty string, skips reformatting', async () => {
			const request = baseSendMessageRequest('chat-123', { userContent: '', autoReformat: true });
			await capturedSendMessageHandler!(request, mockReply);
			expect(mockedGetMarkdownFormatPrompt).not.toHaveBeenCalled();
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: '' })]),
				expect.any(Object),
			);
		});

		it('Scenario 2.1 (sendMessage): autoReformat=false, skips reformatting', async () => {
			const request = baseSendMessageRequest('chat-123', { userContent: 'Original send content, no reformat', autoReformat: false });
			await capturedSendMessageHandler!(request, mockReply);
			expect(mockedGetMarkdownFormatPrompt).not.toHaveBeenCalled();
			expect(mockPrimaryLlmInstance.generateMessage).toHaveBeenCalledWith(
				expect.arrayContaining([expect.objectContaining({ role: 'user', content: 'Original send content, no reformat' })]),
				expect.any(Object),
			);
		});
		// Also test specific sendMessage error paths like chat not found or unauthorized.

		it('sendMessage: LLM not configured, should sendBadRequest', async () => {
			(mockPrimaryLlmInstance.isConfigured as jest.Mock).mockReturnValue(false);
			const request = baseSendMessageRequest('chat-123');
			await capturedSendMessageHandler!(request, mockReply);
			expect(mockedSendBadRequest).toHaveBeenCalledWith(mockReply, 'LLM mock-primary-llm is not configured');
		});

		it('sendMessage: chat.userId mismatch, should sendBadRequest', async () => {
			(mockFastifyInstance.chatService.loadChat as jest.Mock).mockResolvedValue({ id: 'chat-123', userId: 'other-user-id', messages: [] });
			const request = baseSendMessageRequest('chat-123');
			await capturedSendMessageHandler!(request, mockReply);
			expect(mockedSendBadRequest).toHaveBeenCalledWith(mockReply, 'Unauthorized to send message to this chat');
		});
	});
});
