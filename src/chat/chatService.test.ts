import { expect } from 'chai';
import type { ChatService } from '#chat/chatService';
import { SINGLE_USER_ID } from '#modules/memory/inMemoryUserService';
import type { Chat } from '#shared/chat/chat.model';
import type { User } from '#shared/user/user.model';
import { runWithUser } from '#user/userContext';

export const SINGLE_USER: User = {
	enabled: false,
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: {
		enabledLLMs: {},
		defaultLLM: '',
		temperature: 1,
	},
	id: SINGLE_USER_ID,
	name: 'John Doe',
	email: 'user@domain.com',
	functionConfig: {},
	createdAt: new Date(),
};

export const USER_A: User = {
	id: 'user-a-id',
	name: 'User A',
	email: 'usera@example.com',
	enabled: true,
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: {
		enabledLLMs: {},
		defaultLLM: '',
		temperature: 1,
	},
	functionConfig: {},
	createdAt: new Date(),
};

export const USER_B: User = {
	id: 'user-b-id',
	name: 'User B',
	email: 'userb@example.com',
	enabled: true,
	hilBudget: 0,
	hilCount: 0,
	llmConfig: {},
	chat: {
		enabledLLMs: {},
		defaultLLM: '',
		temperature: 1,
	},
	functionConfig: {},
	createdAt: new Date(),
};

export function runChatServiceTests(createService: () => ChatService, beforeEachHook: () => Promise<void> | void = () => {}) {
	let service: ChatService;

	async function expectError(promise: Promise<any>, partialMessage?: string) {
		try {
			await promise;
			expect.fail('Expected promise to reject but it resolved.');
		} catch (error: any) {
			expect(error).to.be.an('Error');
			if (partialMessage) {
				expect(error.message).to.include(partialMessage);
			}
		}
	}

	// Helper function to run test body within user context
	const runWithTestUser = (testFn: () => Promise<void>) => {
		// Ensure the function returned to Mocha/test runner is not async
		// The async work happens inside userContext.run
		return () => runWithUser(SINGLE_USER, testFn);
	};

	beforeEach(async () => {
		// Note: beforeEachHook runs *outside* the user context set by runWithTestUser
		// If the hook needs user context, the approach needs adjustment.
		await beforeEachHook();
		service = createService(); // Create the servic after the environment has been setup with beforeEachHook()
	});

	it(
		'should save and load a chat',
		runWithTestUser(async () => {
			const sampleChat: Chat = {
				id: 'test-chat-id',
				messages: [
					{ role: 'user', content: 'Hello' },
					{ role: 'assistant', content: 'Hi there! How can I help you?' },
				],
				updatedAt: Date.now(),
				userId: SINGLE_USER_ID,
				shareable: false,
				title: 'test',
				parentId: undefined,
				rootId: undefined,
			};

			// Save the chat
			const savedChat = await service.saveChat(sampleChat);

			// Load the chat
			const loadedChat = await service.loadChat(sampleChat.id);

			// Verify that the loaded chat matches the saved chat
			expect(loadedChat).to.deep.equal(savedChat);
			expect(loadedChat).to.deep.equal(sampleChat);
		}),
	);

	it(
		'should save a chat with an empty message array',
		runWithTestUser(async () => {
			const emptyChatId = 'empty-chat-id';
			const emptyChat: Chat = {
				id: emptyChatId,
				userId: SINGLE_USER_ID,
				title: 'test',
				shareable: false,
				messages: [],
				updatedAt: Date.now(),
				parentId: undefined,
				rootId: undefined,
			};

			const savedChat = await service.saveChat(emptyChat);
			expect(savedChat).to.deep.equal(emptyChat);

			const loadedChat = await service.loadChat(emptyChatId);
			expect(loadedChat).to.deep.equal(emptyChat);
		}),
	);

	it(
		'should handle a chat with parentId',
		runWithTestUser(async () => {
			const parentChat: Chat = {
				id: 'parent-chat-id',
				userId: SINGLE_USER_ID,
				shareable: false,
				title: 'test',
				messages: [{ role: 'user', content: 'Parent message' }],
				updatedAt: Date.now(),
				parentId: undefined,
				rootId: undefined,
			};

			const childChat: Chat = {
				id: 'child-chat-id',
				userId: SINGLE_USER_ID,
				shareable: false,
				parentId: parentChat.id,
				rootId: parentChat.id,
				title: 'test',
				updatedAt: Date.now(),
				messages: [{ role: 'assistant', content: 'Child message' }],
			};

			await service.saveChat(parentChat);
			await service.saveChat(childChat);

			const loadedChildChat = await service.loadChat(childChat.id);
			expect(loadedChildChat).to.deep.equal(childChat);
		}),
	);

	describe('listChats', () => {
		// Apply wrapper to tests within describe block
		it(
			'should list chats with pagination',
			runWithTestUser(async () => {
				// Use distinct timestamps
				const baseTime = Date.now();
				const chats: Chat[] = [
					{
						id: 'chat1',
						userId: SINGLE_USER_ID,
						title: 'Chat 1',
						shareable: false,
						messages: [],
						parentId: undefined,
						rootId: undefined,
						updatedAt: baseTime - 2000, // Oldest
					},
					{
						id: 'chat2',
						userId: SINGLE_USER_ID,
						title: 'Chat 2',
						shareable: false,
						messages: [],
						parentId: undefined,
						rootId: undefined,
						updatedAt: baseTime - 1000, // Middle
					},
					{
						id: 'chat3',
						userId: SINGLE_USER_ID,
						title: 'Chat 3',
						shareable: false,
						messages: [],
						parentId: undefined,
						rootId: undefined,
						updatedAt: baseTime, // Newest
					},
				];

				// Save in reverse order to ensure insertion order doesn't match sorted order
				for (const chat of [...chats].reverse()) {
					await service.saveChat(chat);
				}

				// Sorted order should be chat3, chat2, chat1 (newest first)
				const listAllResult = await service.listChats();
				expect(listAllResult.chats.map((c) => c.id)).to.deep.equal(['chat3', 'chat2', 'chat1']);
				expect(listAllResult.chats).to.have.lengthOf(3);
				expect(listAllResult.hasMore).to.be.false;

				// Limit test: Get first 2 (chat3, chat2)
				const limitResult = await service.listChats(undefined, 2); // Use undefined for startAfterId
				expect(limitResult.chats.map((c) => c.id)).to.deep.equal(['chat3', 'chat2']);
				expect(limitResult.chats).to.have.lengthOf(2);
				expect(limitResult.hasMore).to.be.true;

				// Pagination test: Get next 2 starting after chat2 (should be chat1)
				const pagedResult = await service.listChats('chat2', 2);
				expect(pagedResult.chats.map((c) => c.id)).to.deep.equal(['chat1']); // Expecting chat1
				expect(pagedResult.chats).to.have.lengthOf(1); // Expecting length 1
				expect(pagedResult.hasMore).to.be.false;
			}),
		);

		it(
			'should return an empty array when no chats are available',
			runWithTestUser(async () => {
				const result = await service.listChats();
				expect(result.chats).to.be.an('array').that.is.empty;
				expect(result.hasMore).to.be.false;
			}),
		);
	});

	describe('Multi-User Isolation Tests', () => {
		it("should prevent User B from loading User A's private chat", async () => {
			const chatAId = `chat-a-private-${Date.now()}`; // Unique ID for test
			await runWithUser(USER_A, async () => {
				const chatA_Data: Chat = {
					id: chatAId,
					userId: USER_A.id,
					title: 'User A Private Chat',
					messages: [{ role: 'user', content: 'Hello from A' }],
					updatedAt: Date.now(),
					shareable: false, // Explicitly private
					parentId: undefined,
					rootId: undefined,
				};
				await service.saveChat(chatA_Data);
			});

			await runWithUser(USER_B, async () => {
				await expectError(service.loadChat(chatAId), 'Chat not visible');
			});
		});

		it("should prevent User B from saving/updating User A's chat", async () => {
			const chatA_Id = `chat-a-tosave-${Date.now()}`;
			let chatA_InitialData: Chat | null = null;

			await runWithUser(USER_A, async () => {
				chatA_InitialData = {
					id: chatA_Id,
					userId: USER_A.id,
					title: 'User A Original Title',
					messages: [],
					updatedAt: Date.now(),
					shareable: false,
					parentId: undefined,
					rootId: undefined,
				};
				await service.saveChat(chatA_InitialData);
			});

			await runWithUser(USER_B, async () => {
				const chatToAttemptUpdate: Chat = {
					...chatA_InitialData!,
					title: 'Attempted Update by B',
					// userId remains USER_A.id
				};
				await expectError(service.saveChat(chatToAttemptUpdate));
			});
		});

		it("should prevent User B from deleting User A's chat", async () => {
			const chatAId = `chat-a-todelete-${Date.now()}`;
			await runWithUser(USER_A, async () => {
				const chatA_Data: Chat = {
					id: chatAId,
					userId: USER_A.id,
					title: 'User A To Delete',
					messages: [],
					updatedAt: Date.now(),
					shareable: false,
					parentId: undefined,
					rootId: undefined,
				};
				await service.saveChat(chatA_Data);
			});

			await runWithUser(USER_B, async () => {
				await expectError(service.deleteChat(chatAId), 'Not authorized');
			});
		});

		it('listChats should only return chats for the current user', async () => {
			const chatA1_id = `chatA1-${Date.now()}`;
			const chatA2_id = `chatA2-${Date.now()}`;
			const chatB1_id = `chatB1-${Date.now()}`;

			await runWithUser(USER_A, async () => {
				await service.saveChat({
					id: chatA1_id,
					userId: USER_A.id,
					title: 'A1',
					messages: [],
					updatedAt: Date.now() - 200,
					shareable: false,
					parentId: undefined,
					rootId: undefined,
				});
				await service.saveChat({
					id: chatA2_id,
					userId: USER_A.id,
					title: 'A2',
					messages: [],
					updatedAt: Date.now() - 100,
					shareable: false,
					parentId: undefined,
					rootId: undefined,
				});
			});

			await runWithUser(USER_B, async () => {
				await service.saveChat({
					id: chatB1_id,
					userId: USER_B.id,
					title: 'B1',
					messages: [],
					updatedAt: Date.now(),
					shareable: false,
					parentId: undefined,
					rootId: undefined,
				});
			});

			await runWithUser(USER_A, async () => {
				const { chats } = await service.listChats();
				const chatIds = chats.map((c) => c.id);
				expect(chatIds).to.include.members([chatA1_id, chatA2_id]);
				expect(chatIds).to.not.include.members([chatB1_id]);
			});

			await runWithUser(USER_B, async () => {
				const { chats } = await service.listChats();
				const chatIds = chats.map((c) => c.id);
				expect(chatIds).to.include.members([chatB1_id]);
				expect(chatIds).to.not.include.members([chatA1_id, chatA2_id]);
			});
		});
	});
}
