import { InMemoryUserService } from '#modules/memory/inMemoryUserService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { runUserServiceTests } from '#user/userService.test';

describe('InMemoryUserService', () => {
	setupConditionalLoggerOutput();
	const createInMemoryUserService = () => {
		const service = new InMemoryUserService();
		service.users = []; // Ensure a clean state for each test run
		return service;
	};

	runUserServiceTests(createInMemoryUserService, () => {
		// No specific beforeEach needed here as createInMemoryUserService handles reset
	});
});
