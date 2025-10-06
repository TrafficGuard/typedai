import { expect } from 'chai';
import { runChatServiceTests } from '#chat/chatService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { db } from './db';
import { PostgresChatService } from './postgresChatService';
import { ensureChatsTableExists, ensureUsersTableExists } from './schemaUtils';

describe('PostgresChatService', () => {
	setupConditionalLoggerOutput();
	beforeEach(async () => {
		try {
			// Ensure tables exist FIRST
			console.log('[PostgresChatService.test.ts] Attempting to ensure users table exists...');
			await ensureUsersTableExists(db);
			console.log('[PostgresChatService.test.ts] Users table ensured (or already existed).');

			console.log('[PostgresChatService.test.ts] Attempting to ensure chats table exists...');
			await ensureChatsTableExists(db);
			console.log('[PostgresChatService.test.ts] Chats table ensured (or already existed).');

			// Then clear any existing data
			console.log('[PostgresChatService.test.ts] Attempting to delete from chats table...');
			await db.deleteFrom('chats').execute();
			console.log('[PostgresChatService.test.ts] Deleted from chats table.');

			console.log('[PostgresChatService.test.ts] Attempting to delete from users table...');
			await db.deleteFrom('users').execute();
			console.log('[PostgresChatService.test.ts] Deleted from users table.');
		} catch (error) {
			console.error('[PostgresChatService.test.ts] Error in beforeEach:', error);
			throw error;
		}
	});

	runChatServiceTests(() => new PostgresChatService());

	it('should persist assistant response after update', async () => {
		const service = new PostgresChatService();

		// Create an initial chat for the current user
		const created = await service.saveChat({
			title: 'Test chat',
			updatedAt: Date.now(),
			shareable: false,
			messages: [],
		} as any);

		// Append a user and an assistant message, then save
		const userMsg = { role: 'user', content: 'Hello' } as any;
		const assistantMsg = { role: 'assistant', content: 'Hi there' } as any;

		const updated = { ...created, messages: [userMsg, assistantMsg] };
		await service.saveChat(updated);

		// Reload and verify messages were persisted
		const reloaded = await service.loadChat(created.id);
		expect(reloaded.messages).to.have.length(2);
		expect(reloaded.messages[0]).to.deep.equal(userMsg);
		expect(reloaded.messages[1]).to.deep.equal(assistantMsg);
	});
});
