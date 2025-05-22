import { runVibeRepositoryTests } from '../../vibe/vibeRepository.test';
import { db } from './db'; // <-- Add this import
import { PostgresVibeRepository } from './postgresVibeRespository';
import { ensureVibeTablesExist } from './schemaUtils'; // <-- Add this import

describe('PostgresVibeRepository', () => {
	// Setup and teardown the emulator environment once for the suite
	before(async () => {});
	after(async () => {});

	// Run the shared tests, providing the factory and hooks
	runVibeRepositoryTests(
		() => new PostgresVibeRepository(),
		async () => {
			// This is the beforeEachHook for the describe block *inside* runVibeRepositoryTests.
			await ensureVibeTablesExist(); // <-- Ensure tables are created
			// Clear the tables before each test execution managed by runVibeRepositoryTests.
			await db.deleteFrom('vibe_sessions').execute(); // <-- Clear vibe_sessions
			await db.deleteFrom('vibe_presets').execute(); // <-- Clear vibe_presets
		},
		async () => {
			// This is the afterEachHook for the describe block *inside* runVibeRepositoryTests.
			// Optional: any cleanup after each test execution.
		},
	);

	// Additional tests must only be added in the shared VibeRepository tests at src/vibe/vibeRepository.test.ts
});
