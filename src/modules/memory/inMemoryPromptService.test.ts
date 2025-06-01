import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { InMemoryPromptService } from './inMemoryPromptService';

describe('InMemoryPromptService', () => {
	setupConditionalLoggerOutput();
	runPromptsServiceTests(() => new InMemoryPromptService());
});
