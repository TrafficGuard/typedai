import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { appContext } from '#app/applicationContext';
import { runAgentStateServiceTests } from '#agent/agentContextService/agentContextService.test';
import { testUser, otherUser } from '#agent/agentContextService/agentContextService.testSharedData'; // Assuming shared data is exported
import { PostgresAgentStateService } from './postgresAgentStateService';
import { db } from './db';
import { setupConditionalLoggerOutput } from '#test/testUtils';

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
