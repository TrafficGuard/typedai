import { type Db, MongoClient } from 'mongodb';
import { runChatServiceTests } from '#chat/chatService.test';
import { MongoChatService } from '#mongo/MongoChatService';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe.skip('MongoChatService', () => {
	setupConditionalLoggerOutput();

	let client: MongoClient;
	let db: Db;

	// This beforeEach hook runs before each test case executed by runChatServiceTests.
	// It is responsible for setting up the MongoDB connection and initializing the `db` object.
	beforeEach(async () => {
		client = new MongoClient(process.env.MONGO_URI_TEST || 'mongodb://localhost:27017');
		const dbName = process.env.MONGO_DB_NAME_TEST_CHAT || 'typedai_test_db_chat'; // Use a specific DB name for chat tests
		try {
			await client.connect();
			db = client.db(dbName);
			// Initial cleanup of the 'chats' collection before any test from the shared suite runs.
			// The perTestSetupHook will also clear it, but this ensures a clean start.
			await db.collection('chats').deleteMany({});
		} catch (error: any) {
			console.error(`Error during MongoDB test setup in DB ${dbName}:`, error);
			// Attempt to close client if connection was established before error
			if (client && typeof client.close === 'function') {
				try {
					await client.close();
				} catch (closeError) {
					console.error('Error closing MongoDB client during setup error:', closeError);
				}
			}
			throw error;
		}
	});

	// This afterEach hook runs after each test case executed by runChatServiceTests.
	// It is responsible for closing the MongoDB connection.
	afterEach(async () => {
		if (client && typeof client.close === 'function') {
			await client.close();
		}
	});

	// Factory function to create an instance of MongoChatService.
	// This function will be called by runChatServiceTests.
	const createMongoChatService = () => {
		if (!db) {
			// This check is a safeguard; `db` should be initialized by the `beforeEach` hook.
			throw new Error('MongoDB db instance not initialized. Ensure MongoDB is running and accessible.');
		}
		return new MongoChatService(db);
	};

	// Hook to be passed to runChatServiceTests.
	// According to src/chat/chatService.test.ts, this hook runs *after* the service is created
	// but *before* the actual test logic within each test case of the shared suite.
	// This is a suitable place to ensure the 'chats' collection is empty for each specific test.
	const perTestSetupHook = async () => {
		if (!db) {
			// This check is a safeguard.
			throw new Error('MongoDB db instance not available for per-test setup.');
		}
		try {
			// Clear the 'chats' collection to ensure test isolation.
			await db.collection('chats').deleteMany({});
		} catch (error) {
			console.error('Error clearing "chats" collection in perTestSetupHook:', error);
			throw error;
		}
	};

	// Run the shared chat service tests against the MongoChatService implementation.
	runChatServiceTests(
		createMongoChatService, // The factory function to create the service instance.
		perTestSetupHook, // The hook to run before each test in the shared suite.
	);
});
