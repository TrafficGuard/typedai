import { PostgresVibeRepository } from '#modules/postgres/postgresVibeRespository';
import { runVibeRepositoryTests } from '#vibe/vibeRepository.test';

describe('PostgresVibeRepository', () => {
	// Setup and teardown the emulator environment once for the suite
	before(async () => {});
	after(async () => {});

	// Run the shared tests, providing the factory and hooks
	runVibeRepositoryTests(
		() => new PostgresVibeRepository(),
		async () => {},
		async () => {},
	);

	// Additional tests must only be added in the shared VibeRepository tests at src/vibe/vibeRepository.test.ts
});
