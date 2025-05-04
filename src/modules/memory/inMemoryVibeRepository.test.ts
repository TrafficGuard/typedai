import sinon from 'sinon';
// Removed User import
// Removed userContext import
import { runVibeRepositoryTests } from '#vibe/vibeRepository.test';
import { InMemoryVibeRepository } from './inMemoryVibeRepository';

// Removed mock user constants

let repositoryInstance: InMemoryVibeRepository;
// Removed currentUserStub variable

// Configure and run the shared tests
describe('InMemoryVibeRepository', () => {
	// Removed beforeEach managing currentUserStub

	afterEach(() => {
		// Restore any other sinon stubs if needed (though none are expected here now)
		sinon.restore();
	});

	// Run the shared tests, providing the factory and hooks
	runVibeRepositoryTests(
		() => {
			// Factory function: Create a new instance for each test run via runVibeRepositoryTests's beforeEach
			repositoryInstance = new InMemoryVibeRepository();
			return repositoryInstance;
		},
		() => {
			// beforeEachHook (runs before each test *inside* runVibeRepositoryTests)
			// Before each test in the shared suite, clear the in-memory store
			// The instance is created by the factory above just before this hook runs.
			if (repositoryInstance) {
				repositoryInstance.clear();
			}
			// No stub management needed here anymore
		},
		() => {
			// afterEachHook (runs after each test *inside* runVibeRepositoryTests)
			// No specific action needed here; cleanup handled by outer afterEach
		},
		// Removed currentUserStub, testUser, otherUser arguments
	);

	// Add InMemory-specific tests here if needed
});
