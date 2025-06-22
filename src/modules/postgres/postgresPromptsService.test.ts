import { PostgresPromptsService } from '#modules/postgres/postgresPromptsService';
import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { db } from './db';
import { ensurePromptsTablesExist, ensureUsersTableExists } from './schemaUtils';

describe('PostgresPromptsService', () => {
	setupConditionalLoggerOutput();
	runPromptsServiceTests(
		() => new PostgresPromptsService(),
		async () => {
			await ensureUsersTableExists(db);
			await ensurePromptsTablesExist(db);

			// Clean tables between tests
			await db.deleteFrom('prompt_revisions').execute();
			await db.deleteFrom('prompt_groups').execute();
			await db.deleteFrom('users').execute();
		},
	);
});
