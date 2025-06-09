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
});
