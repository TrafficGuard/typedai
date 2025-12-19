import { setupConditionalLoggerOutput } from '#test/testUtils';
import { runDebateStateServiceTests } from './debateStateService.test';
import { InMemoryDebateStateService } from './inMemoryDebateStateService';

describe('InMemoryDebateStateService', () => {
	setupConditionalLoggerOutput();

	let service: InMemoryDebateStateService;

	runDebateStateServiceTests(
		() => {
			service = new InMemoryDebateStateService();
			return service;
		},
		() => {
			// Clear the service before each test
			if (service) {
				service.clear();
			}
		},
	);

	// DO NOT add tests here. All tests must be in the shared DebateStateService test suite in debateStateService.test.ts
});
