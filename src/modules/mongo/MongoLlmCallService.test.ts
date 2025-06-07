import { type Db, MongoClient } from 'mongodb';
import { runLlmCallServiceTests } from '#llm/llmCallService/llmCallService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { MongoLlmCallService } from './MongoLlmCallService';

// Define the collection name as a constant for easy modification if needed.
const LLM_CALLS_COLLECTION_NAME = 'llmCalls';

describe.skip('MongoLlmCallService', () => {
	setupConditionalLoggerOutput();

	let client: MongoClient;
	let db: Db;

	// Configuration for the test MongoDB instance.
	// Uses environment variable if set, otherwise defaults to a local MongoDB instance.
	// A unique database name is generated for each test suite run to ensure isolation.
	const MONGODB_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
	const TEST_DB_NAME = `test_typedai_llmcallservice_${Date.now()}`;

	before(async () => {
		// Establish a connection to the MongoDB server once before all tests.
		client = new MongoClient(MONGODB_URI);
		await client.connect();
		// Get a reference to the test database.
		db = client.db(TEST_DB_NAME);
	});

	after(async () => {
		// Clean up after all tests are done.
		if (db) {
			// Drop the test database to remove all test data.
			await db.dropDatabase();
		}
		if (client) {
			// Close the MongoDB connection.
			await client.close();
		}
	});

	/**
	 * Factory function to create an instance of MongoLlmCallService.
	 * This function will be passed to runLlmCallServiceTests.
	 * @returns A new instance of MongoLlmCallService.
	 */
	const createMongoLlmCallService = () => {
		// MongoLlmCallService constructor expects a MongoDB Db instance.
		if (!db) {
			// This check is a safeguard; `db` should be initialized by the `before` hook.
			throw new Error('MongoDB db instance not initialized. Ensure MongoDB is running and accessible.');
		}
		return new MongoLlmCallService(db);
	};

	/**
	 * Hook function to reset the MongoDB state before/after each test in the shared suite.
	 * This ensures that each test runs with a clean collection.
	 */
	const resetMongoDbCollection = async () => {
		if (db) {
			// Delete all documents from the relevant collection.
			// This is safe to call even if the collection doesn't exist or is empty.
			await db.collection(LLM_CALLS_COLLECTION_NAME).deleteMany({});
		}
	};

	// Execute the shared LlmCallService tests.
	// - createMongoLlmCallService: Provides an instance of the service to be tested.
	// - resetMongoDbCollection: Hook to run before each test in the shared suite to clean the database.
	// - resetMongoDbCollection: Hook to run after each test in the shared suite to clean the database.
	runLlmCallServiceTests(createMongoLlmCallService, resetMongoDbCollection, resetMongoDbCollection);

	// If MongoLlmCallService has specific behaviors not covered by the shared tests
	// (e.g., specific handling of BSON types, MongoDB-specific query optimizations that affect results,
	// or unique error handling for Mongo-specific issues),
	// those tests can be added in a separate describe block here.
	// For example:
	// describe('MongoLlmCallService - MongoDB Specific Tests', () => {
	//   let service: MongoLlmCallService;
	//
	//   beforeEach(async () => {
	//     // Ensure the collection is clean before each specific test too
	//     await resetMongoDbCollection();
	//     service = createMongoLlmCallService();
	//   });
	//
	//   it('should handle a MongoDB-specific scenario', async () => {
	//     // Test logic for MongoDB-specific behavior
	//   });
	// });
});
