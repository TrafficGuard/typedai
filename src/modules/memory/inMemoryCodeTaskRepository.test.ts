import sinon from 'sinon';
// Removed User import
// Removed userContext import
import { runCodeTaskRepositoryTests } from '#codeTask/codeTaskRepository.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { InMemoryCodeTaskRepository } from './inMemoryCodeTaskRepository';

// Removed mock user constants

let repositoryInstance: InMemoryCodeTaskRepository;
// Removed currentUserStub variable

// Configure and run the shared tests
describe('InMemoryCodeTaskRepository', () => {
	setupConditionalLoggerOutput();
	// Removed beforeEach managing currentUserStub

	afterEach(() => {
		// Restore any other sinon stubs if needed (though none are expected here now)
		sinon.restore();
	});

	// Run the shared tests, providing the factory and hooks
	runCodeTaskRepositoryTests(
		() => {
			// Factory function: Create a new instance for each test run via runCodeTaskRepositoryTests's beforeEach
			repositoryInstance = new InMemoryCodeTaskRepository();
			return repositoryInstance;
		},
		() => {
			// beforeEachHook (runs before each test *inside* runCodeTaskRepositoryTests)
			// Before each test in the shared suite, clear the in-memory store
			// The instance is created by the factory above just before this hook runs.
			if (repositoryInstance) {
				repositoryInstance.clear();
			}
			// No stub management needed here anymore
		},
		() => {
			// afterEachHook (runs after each test *inside* runCodeTaskRepositoryTests)
			// No specific action needed here; cleanup handled by outer afterEach
		},
		// Removed currentUserStub, testUser, otherUser arguments
	);

	// Add InMemory-specific tests here if needed
});
