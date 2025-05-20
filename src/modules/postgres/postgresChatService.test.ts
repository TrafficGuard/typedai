import { runChatServiceTests } from '#chat/chatService.test';
import { PostgresChatService } from './postgresChatService';
import { db } from './db';

describe('PostgresChatService', () => {
	runChatServiceTests(
		() => new PostgresChatService(),
		async () => {
			try {
				// Attempt to delete all rows from the 'chats' table.
				// This is generally faster and safer than dropping/recreating the table in a test context,
				// especially if schema migrations are handled elsewhere or the table structure is stable.
				await db.deleteFrom('chats').execute();
			} catch (error: any) {
				// Check if the error is because the table doesn't exist (e.g., first run or specific DB states).
				// PostgreSQL error code for "undefined_table" is 42P01.
				// SQLite might throw an error with a message like "no such table: chats".
				// MySQL might use ER_NO_SUCH_TABLE (1146).
				if (
					(error.code && error.code === '42P01') || // PostgreSQL
					(error.message && error.message.toLowerCase().includes('no such table')) || // SQLite, potentially others
					(error.errno && error.errno === 1146) // MySQL
				) {
					// Log a warning if the table doesn't exist, as it's not an error for the test setup.
					// This can happen if tests are run before migrations or if the DB is clean.
					console.warn('Test setup: "chats" table does not exist or is empty, skipping truncation.');
				} else {
					// For any other errors, log them and rethrow to fail the test setup.
					console.error('Error truncating/clearing chats table in test setup:', error);
					throw error;
				}
			}
		},
	);
});
