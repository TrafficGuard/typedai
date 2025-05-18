import { InMemoryUserService } from '#modules/memory/inMemoryUserService';
import { runUserServiceTests } from '#user/userService.test';

describe('InMemoryUserService', () => {
	const createInMemoryUserService = () => {
		const service = new InMemoryUserService();
		service.users = []; // Ensure a clean state for each test run
		return service;
	};

	runUserServiceTests(createInMemoryUserService, () => {
		// No specific beforeEach needed here as createInMemoryUserService handles reset
	});
});
