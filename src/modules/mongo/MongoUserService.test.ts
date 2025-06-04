import { type Db, MongoClient } from 'mongodb';
import { runUserServiceTests } from '#user/userService.test';
import { MongoUserService } from './MongoUserService';

describe.skip('MongoUserService', () => {
	// setupConditionalLoggerOutput() is called within runUserServiceTests,
	// so it should not be called directly here, following the pattern
	// observed in firestoreUserService.test.ts and the structure of userService.test.ts.

	let client: MongoClient;
	let db: Db;

	// Configuration for the test MongoDB instance.
	// Uses environment variable if set, otherwise defaults to a local MongoDB instance.
	// A unique database name is generated for each test suite run to ensure isolation.
	const MONGODB_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017';
	const TEST_DB_NAME = `test_typedai_userservice_${Date.now()}`;

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
	 * Factory function to create an instance of MongoUserService.
	 * This function will be passed to runUserServiceTests.
	 * @returns A new instance of MongoUserService.
	 */
	const createMongoUserService = () => {
		// MongoUserService constructor expects a MongoDB Db instance.
		return new MongoUserService(db);
	};

	/**
	 * Hook function to reset the MongoDB state before each test.
	 * This ensures that each test runs with a clean 'users' collection.
	 */
	const resetMongoDb = async () => {
		if (db) {
			// Delete all documents from the 'users' collection.
			// This is safe to call even if the collection doesn't exist or is empty.
			await db.collection('users').deleteMany({});
		}
	};

	// Execute the shared UserService tests.
	// - createMongoUserService: Provides an instance of the service to be tested.
	// - resetMongoDb: Hook to run before each test in the shared suite to clean the database.
	// - resetMongoDb: Hook to run after each test in the shared suite (maintaining consistency with firestore pattern, though primarily for cleanup before next test).
	runUserServiceTests(createMongoUserService, resetMongoDb, resetMongoDb);
});
