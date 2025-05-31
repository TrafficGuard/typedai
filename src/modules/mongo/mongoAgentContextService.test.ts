import { type Db, MongoClient } from 'mongodb';
import sinon from 'sinon';
import * as appContextModule from '#app/applicationContext';
import { MongoUserService } from '#mongo/MongoUserService';
import { setupConditionalLoggerOutput } from '#test/testUtils'; // Added as per style guide
import { runAgentStateServiceTests } from '../../agent/agentContextService/agentContextService.test';
import { MongoAgentContextService } from './MongoAgentContextService';

describe('MongoAgentContextService', () => {
	setupConditionalLoggerOutput(); // Added as per style guide

	let client: MongoClient;
	let db: Db;
	let mongoUserService: MongoUserService; // Will be an instance of the actual MongoUserService

	before(async () => {
		// Initialize MongoDB client and connect
		// Use environment variables for configuration, with defaults for local testing
		const mongoUri = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017';
		const dbName = process.env.MONGO_DB_NAME_TEST || 'typedai_test_agent_context_service';

		client = new MongoClient(mongoUri);
		await client.connect();
		db = client.db(dbName);

		// Initialize MongoUserService with the test database
		mongoUserService = new MongoUserService(db);

		// Stub appContext to return our mongoUserService instance.
		// This is crucial because the shared test suite (runAgentStateServiceTests)
		// uses appContext().userService to create/manage test users.
		// The actual methods of mongoUserService (like createUser, getUser) will be called.
		// If these methods are not implemented in MongoUserService.ts, test setup might fail.
		sinon.stub(appContextModule, 'appContext').returns({
			userService: mongoUserService,
			// Add other services if they were to be needed by the SUT or test setup,
			// but for AgentContextService tests, userService is the primary concern from appContext.
		} as any); // Use 'as any' to simplify stubbing of the ApplicationContext type
	});

	after(async () => {
		// Restore any sinon stubs/spies
		sinon.restore(); // This will clean up the appContext stub

		// Close the MongoDB client connection
		if (client) {
			await client.close();
		}
	});

	// beforeEachHook: Clears relevant MongoDB collections before each test case.
	// This ensures test isolation.
	const beforeEachHook = async () => {
		if (db) {
			// Collections used by MongoAgentContextService
			await db.collection('agentContexts').deleteMany({});
			await db.collection('agentIterations').deleteMany({});

			// Collection assumed to be used by MongoUserService (for user setup in shared tests)
			// This collection name 'users' is an assumption. If MongoUserService uses a different
			// collection name, it should be updated here.
			await db.collection('users').deleteMany({});
		}
	};

	// afterEachHook: Can be used for cleanup specific to this implementation after each test.
	// For now, an empty async function is sufficient as major cleanup (DB, sinon) is handled
	// in beforeEachHook and the shared test suite's afterEach.
	const afterEachHook = async () => {
		// No specific MongoDB post-test cleanup needed here for now.
	};

	// Invoke the shared test suite
	// Pass:
	// 1. A factory function to create an instance of MongoAgentContextService.
	// 2. The beforeEachHook defined above for MongoDB cleanup.
	// 3. The afterEachHook defined above.
	runAgentStateServiceTests(() => new MongoAgentContextService(db), beforeEachHook, afterEachHook);
});
