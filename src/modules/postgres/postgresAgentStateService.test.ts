import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { otherUser, runAgentStateServiceTests, testUser } from '#agent/agentContextService/agentContextService.test';
import { appContext } from '#app/applicationContext';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { db } from './db';
import { PostgresAgentStateService } from './postgresAgentStateService';
import { ensureAgentContextsTableExists, ensureAgentIterationsTableExists, ensureUsersTableExists } from './schemaUtils';

chai.use(chaiAsPromised);

describe('PostgresAgentStateService', () => {
	setupConditionalLoggerOutput();
	const userService = appContext().userService;

	const beforeEachHook = async () => {
		// Drop tables to ensure schema is recreated with latest definitions
		await db.schema.dropTableIfExists('agent_iterations').execute();
		await db.schema.dropTableIfExists('agent_contexts').execute();
		await db.schema.dropTableIfExists('users').execute();

		// Ensure all necessary tables exist with latest schema
		await ensureUsersTableExists(db);
		await ensureAgentContextsTableExists(db);
		await ensureAgentIterationsTableExists(db);

		// Ensure test users exist in the database, as the service might interact with user data
		// or deserialization logic might depend on user context.
		try {
			await userService.getUser(testUser.id);
		} catch (e) {
			// If user doesn't exist, create them.
			// Assumes createUser handles cases where user might already exist due to a previous partial run,
			// or that the DB is clean.
			await userService.createUser(testUser);
		}
		try {
			await userService.getUser(otherUser.id);
		} catch (e) {
			await userService.createUser(otherUser);
		}

		// Clean the specific tables for AgentStateService tests.
		// Order: iterations first, then contexts, due to foreign key relationship
		// (though ON DELETE CASCADE should handle this, explicit order is safer).
		await db.deleteFrom('agent_iterations').execute();
		await db.deleteFrom('agent_contexts').execute();
	};

	const afterEachHook = async () => {
		// No specific cleanup needed for Postgres in afterEach for these tests,
		// as Kysely's connection pool manages connections.
	};

	// Execute the shared test suite for AgentContextService implementations.
	runAgentStateServiceTests(
		() => new PostgresAgentStateService(db), // Factory function to create an instance of the service.
		beforeEachHook, // Hook to run before each test case in the shared suite.
		afterEachHook, // Hook to run after each test case.
	);
});
