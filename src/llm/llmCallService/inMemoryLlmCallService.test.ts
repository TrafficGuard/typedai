import { InMemoryLlmCallService } from '#llm/llmCallService/inMemoryLlmCallService'; // Adjust path if necessary
import { runLlmCallServiceTests } from '#llm/llmCallService/llmCallService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('InMemoryLlmCallService', () => {
	setupConditionalLoggerOutput();

	runLlmCallServiceTests(
		() => {
			// This factory is called by runLlmCallServiceTests to get an instance of the service.
			// A new instance for each run of the shared test suite's describe block ensures a clean state.
			return new InMemoryLlmCallService();
		},
		() => {
			// This is the beforeEachHook for the describe block *inside* runLlmCallServiceTests.
			// Since a new InMemoryLlmCallService is created for each test run by runLlmCallServiceTests's
			// own beforeEach, this hook can often be empty if the constructor ensures a clean state.
			// If the service had some static state or needed explicit clearing per test *case*,
			// that logic would go here.
		},
		// No specific afterEachHook needed beyond what runLlmCallServiceTests provides (sinon.restore).
	);

	// Add InMemory-specific tests here if needed.
	// For example, if the InMemory service has specific behaviors or limitations
	// not covered by the general interface tests.
});
