import { runCodeTaskRepositoryTests } from '#codeTask/codeTaskRepository.test';
import { PostgresCodeTaskRepository } from '#modules/postgres/postgresCodeTaskRepository';
import { db } from './db'; // <-- Add this import
import { ensureCodeTaskTablesExist } from './schemaUtils';

describe('PostgresCodeTaskRepository', () => {
	// Setup and teardown the emulator environment once for the suite
	before(async () => {});
	after(async () => {});

	// Run the shared tests, providing the factory and hooks
	runCodeTaskRepositoryTests(
		() => new PostgresCodeTaskRepository(),
		async () => {
			// This is the beforeEachHook for the describe block *inside* runCodeTaskRepositoryTests.
			await ensureCodeTaskTablesExist(); // <-- Ensure tables are created
			// Clear the tables before each test execution managed by runCodeTaskRepositoryTests.
			await db.deleteFrom('code_task_sessions').execute(); // <-- Clear code_task_sessions
			await db.deleteFrom('code_task_presets').execute(); // <-- Clear code_task_presets
		},
		async () => {
			// This is the afterEachHook for the describe block *inside* runCodeTaskRepositoryTests.
			// Optional: any cleanup after each test execution.
		},
	);

	// Additional tests must only be added in the shared CodeTaskRepository tests at src/codeTask/codeTaskRepository.test.ts
});
