import { runChatServiceTests } from '#chat/chatService.test';
import { db } from './db';
import { PostgresChatService } from './postgresChatService';
import { ensureChatsTableExists, ensureUsersTableExists } from './schemaUtils';

describe('PostgresChatService', () => {
	beforeEach(async () => {
		await db.deleteFrom('chats').execute();
		await db.deleteFrom('users').execute();
		await ensureUsersTableExists(db);
		await ensureChatsTableExists(db);
	});

	runChatServiceTests(() => new PostgresChatService());
});
