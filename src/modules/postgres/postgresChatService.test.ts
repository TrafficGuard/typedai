import { expect } from 'chai';
import { runChatServiceTests } from '#chat/chatService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { db } from './db';
import { PostgresChatService } from './postgresChatService';
import { ensureChatsTableExists, ensureUsersTableExists } from './schemaUtils';

describe('PostgresChatService', () => {
	setupConditionalLoggerOutput();
	beforeEach(async () => {
		// Ensure tables exist FIRST
		await ensureUsersTableExists(db);
		await ensureChatsTableExists(db);

		// Then clear any existing data
		await db.deleteFrom('chats').execute();
		await db.deleteFrom('users').execute();
	});

	runChatServiceTests(() => new PostgresChatService());

	// DO NOT add tests here. All tests must be in the shared ChatService test suite in chatService.test.ts
});
