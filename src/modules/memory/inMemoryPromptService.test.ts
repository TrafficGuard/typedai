import { runPromptsServiceTests } from '#prompts/promptsService.test';
import { InMemoryPromptService } from './inMemoryPromptService';

describe('InMemoryPromptService', () => {
	runPromptsServiceTests(() => new InMemoryPromptService());
});
