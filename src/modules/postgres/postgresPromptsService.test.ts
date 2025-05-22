import { PostgresPromptsService } from '#modules/postgres/postgresPromptsService';
import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { db } from './db';
import { ensureUsersTableExists } from './schemaUtils';

describe('PostgresPromptsService', () => {
	runPromptsServiceTests(
		() => new PostgresPromptsService(),
		async () => {
			await ensureUsersTableExists(db);
			await db.deleteFrom('users').execute();
		},
	);
});
