import { runDebateStateServiceTests } from '#modules/debate/debateStateService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { db } from './db';
import { PostgresDebateStateService } from './postgresDebateStateService';
import { ensureDebateResultsTableExists, ensureDebatesTableExists, ensureUsersTableExists } from './schemaUtils';

describe('PostgresDebateStateService', () => {
	setupConditionalLoggerOutput();

	beforeEach(async () => {
		// Ensure tables exist FIRST
		await ensureUsersTableExists(db);
		await ensureDebatesTableExists(db);
		await ensureDebateResultsTableExists(db);

		// Then clear any existing data (order matters due to FK)
		await db.deleteFrom('debate_results').execute();
		await db.deleteFrom('debates').execute();
		await db.deleteFrom('users').execute();
	});

	runDebateStateServiceTests(() => new PostgresDebateStateService());

	// DO NOT add tests here. All tests must be in the shared DebateStateService test suite in debateStateService.test.ts
});
