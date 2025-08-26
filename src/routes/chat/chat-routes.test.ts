// import { expect } from 'chai';
// import type { AppFastifyInstance } from '#app/applicationTypes';
// import { CHAT_API } from '#shared/chat/chat.api';
// import type { Chat } from '#shared/chat/chat.model';
// import { setupConditionalLoggerOutput } from '#test/testUtils';
// import { createTestFastify } from '../routeTestUtils';
// import { chatRoutes } from './chat-routes';

// describe('Chat Routes', () => {
// 	setupConditionalLoggerOutput();
// 	let fastify: AppFastifyInstance;

// 	beforeEach(async () => {
// 		fastify = await createTestFastify(chatRoutes);
// 	});

// 	afterEach(async () => {
// 		await fastify.close();
// 	});

// 	describe('GET /api/chat/:chatId', () => {
// 		it('should allow unauthenticated users to access a public (shareable) chat', async () => {
// 			// Arrange
// 			const chatId = await fastify.chatService.saveChat({
// 				title: 'Public Chat',
// 				shareable: true,
// 				userId: 'some-owner',
// 			});
// 			// Act
// 			const response = await fastify.inject({
// 				method: 'GET',
// 				url: CHAT_API.getById.path({ chatId }),
// 			});
// 			// Assert
// 			expect(response.statusCode).to.equal(200);
// 			const returnedChat = response.json<Chat>();
// 			expect(returnedChat.id).to.equal(chatId);
// 			expect(returnedChat.shareable).to.be.true;
// 		});

// 		it('should NOT allow unauthenticated users to access a private chat', async () => {
// 			// Arrange
// 			const chatId = await fastify.chatService.createChat({
// 				title: 'Private Chat',
// 				shareable: false,
// 				userId: 'some-owner',
// 			});
// 			// Act
// 			const response = await fastify.inject({
// 				method: 'GET',
// 				url: CHAT_API.getById.path({ chatId }),
// 			});
// 			// Assert
// 			expect(response.statusCode).to.equal(400);
// 			expect(response.json().message).to.include('Unauthorized to view this chat');
// 		});

// 		it('should allow an authenticated user to access their own private chat', async () => {
// 			// Arrange
// 			// The test user is authenticated by default with ID 'user'
// 			const testUser = await fastify.userService.getUser('user');
// 			const chatId = await fastify.chatService.createChat({
// 				title: 'My Private Chat',
// 				shareable: false,
// 				userId: testUser.id,
// 			});
// 			// Act
// 			const response = await fastify.inject({
// 				method: 'GET',
// 				url: CHAT_API.getById.path({ chatId }),
// 			});
// 			// Assert
// 			expect(response.statusCode).to.equal(200);
// 			const returnedChat = response.json<Chat>();
// 			expect(returnedChat.id).to.equal(chatId);
// 			expect(returnedChat.userId).to.equal(testUser.id);
// 		});

// 		it("should NOT allow an authenticated user to access another user's private chat", async () => {
// 			// Arrange
// 			const chatId = await fastify.chatService.createChat({
// 				title: "Someone Else's Private Chat",
// 				shareable: false,
// 				userId: 'another-user-id',
// 			});
// 			// Act
// 			const response = await fastify.inject({
// 				method: 'GET',
// 				url: CHAT_API.getById.path({ chatId }),
// 			});
// 			// Assert
// 			expect(response.statusCode).to.equal(400);
// 			expect(response.json().message).to.include('Unauthorized to view this chat');
// 		});
// 	});
// });
