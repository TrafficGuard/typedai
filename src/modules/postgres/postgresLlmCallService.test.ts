import { runLlmCallServiceTests } from '#llm/llmCallService/llmCallService.test';
import { db } from '#modules/postgres/db';
import { PostgresLlmCallService } from '#modules/postgres/postgresLlmCallService';
import { ensureLlmCallsTableExists } from '#modules/postgres/schemaUtils';

describe('PostgresLlmCallService', () => {
	runLlmCallServiceTests(
		() => new PostgresLlmCallService(),
		async () => {
			await ensureLlmCallsTableExists(db);
			await db.deleteFrom('llm_calls').execute();
		},
		async () => {},
	);

	// Add Postgres-specific tests here if needed.
	// For example, testing specific SQL interactions, constraints, or performance aspects not covered by the general interface tests.
});
