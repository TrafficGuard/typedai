import { runLlmCallServiceTests } from '#llm/llmCallService/llmCallService.test';
import { InMemoryLlmCallService } from '#modules/memory/inMemoryLlmCallService';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('InMemoryLlmCallService', () => {
	setupConditionalLoggerOutput();
	runLlmCallServiceTests(
		() => new InMemoryLlmCallService(),
		() => {},
	);
});
