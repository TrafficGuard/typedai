import { runChatServiceTests } from '#chat/chatService.test';
import { db } from './db';
import { PostgresChatService } from './postgresChatService';
import { ensureChatsTableExists, ensureUsersTableExists } from './schemaUtils';

describe('PostgresChatService', () => {
	beforeEach(async () => {
		// Ensure tables exist FIRST
		await ensureUsersTableExists(db);
		await ensureChatsTableExists(db);

		// Then clear any existing data
		await db.deleteFrom('chats').execute();
		await db.deleteFrom('users').execute();
	});

	runChatServiceTests(() => new PostgresChatService());
});
