import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { otherUser, runAgentStateServiceTests, testUser } from '#agent/agentContextService/agentContextService.test';
import { appContext } from '#app/applicationContext';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { db } from './db';
import { PostgresAgentStateService } from './postgresAgentStateService';

chai.use(chaiAsPromised);

describe('PostgresAgentStateService', () => {
	setupConditionalLoggerOutput();
	const userService = appContext().userService;

	const beforeEachHook = async () => {
		// Ensure users exist for deserialization logic that might use userService
		try {
			await userService.getUser(testUser.id);
		} catch (e) {
			await userService.createUser(testUser);
		}
		try {
			await userService.getUser(otherUser.id);
		} catch (e) {
			await userService.createUser(otherUser);
		}

		// Clean tables - order matters if foreign keys are not ON DELETE CASCADE
		// Assuming agent_iterations references agent_contexts
		await db.deleteFrom('agent_iterations').execute();
		await db.deleteFrom('agent_contexts').execute();
	};

	const afterEachHook = async () => {
		// Optional: any specific cleanup for Postgres if needed
	};

	runAgentStateServiceTests(() => new PostgresAgentStateService(db), beforeEachHook, afterEachHook);
});
