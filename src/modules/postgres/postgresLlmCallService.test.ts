import { db } from '#modules/postgres/db';
import { PostgresLlmCallService } from '#modules/postgres/postgresLlmCallService'; // Adjust path if necessary
import { ensureLlmCallsTableExists } from '#modules/postgres/schemaUtils';
import { runLlmCallServiceTests } from '#llm/llmCallService/llmCallService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('PostgresLlmCallService', () => {
	setupConditionalLoggerOutput();

	runLlmCallServiceTests(
		() => {
			// This factory function is called by runLlmCallServiceTests to get an instance of the service.
			return new PostgresLlmCallService(db); // Pass the db instance if required by constructor
		},
		async () => {
			// This is the beforeEachHook for the describe block *inside* runLlmCallServiceTests.
			// Ensures the table exists and is empty before each test case.
			await ensureLlmCallsTableExists(db);
			await db.deleteFrom('llm_calls').execute();
		},
		async () => {
			// This is the afterEachHook for the describe block *inside* runLlmCallServiceTests.
			// Optional: any cleanup after each test execution.
			// Clearing the table in beforeEach is usually sufficient.
		},
	);

	// Add Postgres-specific tests here if needed.
	// For example, testing specific SQL interactions, constraints, or performance aspects
	// not covered by the general interface tests.
	// Also, consider tests for how PostgresLlmCallService handles fields like
	// cacheCreationInputTokens/cacheReadInputTokens vs cached_input_tokens if the DB schema differs
	// from the LlmCall model and those specific mappings are important to verify.
});
