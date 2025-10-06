import { expect } from 'chai';
import { runChatServiceTests } from '#chat/chatService.test';
import { FirestoreChatService } from '#firestore/firestoreChatService';
import { resetFirestoreEmulator } from '#firestore/resetFirestoreEmulator';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { firestoreDb } from '#firestore/firestore';
import { type Chat } from '#shared/chat/chat.model';

describe('FirestoreChatService', () => {
	setupConditionalLoggerOutput();
	runChatServiceTests(() => new FirestoreChatService(), resetFirestoreEmulator);

	describe('regression: streaming persistence', () => {
		it('should save assistant response for new chat without relying on currentUser ALS', async () => {
			await resetFirestoreEmulator();
			const service = new FirestoreChatService();

			const chat: Chat = {
				userId: 'test-user-1',
				shareable: false,
				title: '',
				updatedAt: Date.now(),
				messages: [
					{ role: 'user', content: 'Hi', time: Date.now() },
					{ role: 'assistant', content: 'Hello', time: Date.now() },
				],
			};

			await service.saveChat(chat);

			const doc = await firestoreDb().doc(`Chats/${chat.id}`).get();
			expect(doc.exists, 'chat doc should exist').to.be.true;

			const data: any = doc.data();
			expect(data.messages).to.have.length(2);
			const last = data.messages[data.messages.length - 1];
			expect(last.role).to.equal('assistant');
			expect(last.content).to.equal('Hello');
		});

		it('should prevent changing chat owner on update', async () => {
			await resetFirestoreEmulator();
			const service = new FirestoreChatService();

			const chat: Chat = {
				userId: 'owner-1',
				shareable: false,
				title: '',
				updatedAt: Date.now(),
				messages: [{ role: 'user', content: 'Yo', time: Date.now() }],
			};

			await service.saveChat(chat);

			(chat as any).userId = 'owner-2';
			await expect(service.saveChat(chat)).to.be.rejectedWith('Not authorized to modify this chat');

			const doc = await firestoreDb().doc(`Chats/${chat.id}`).get();
			const data: any = doc.data();
			expect(data.userId).to.equal('owner-1');
		});
	});
});
