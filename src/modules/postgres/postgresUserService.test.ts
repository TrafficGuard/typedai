import { runUserServiceTests } from '#user/userService.test';
import { db } from './db';
import { PostgresUserService } from './postgresUserService';
import { ensureUsersTableExists } from './schemaUtils';

describe('PostgresUserService', () => {
	// The runUserServiceTests function itself contains a describe block with its own beforeEach/afterEach.
	// The hooks provided to runUserServiceTests will apply within that inner describe block.

	runUserServiceTests(
		() => {
			// This factory function is called by runUserServiceTests to get an instance of the service.
			// It's typically called once per run of the shared test suite's describe block.
			return new PostgresUserService();
		},
		async () => {
			// This is the beforeEachHook for the describe block *inside* runUserServiceTests.
			await ensureUsersTableExists(db);
			// Clear the users table before each test execution managed by runUserServiceTests.
			await db.deleteFrom('users').execute();
		},
		async () => {
			// This is the afterEachHook for the describe block *inside* runUserServiceTests.
			// Optional: any cleanup after each test execution.
			// For many cases, the beforeEachHook is sufficient for ensuring a clean state.
		},
	);
});
