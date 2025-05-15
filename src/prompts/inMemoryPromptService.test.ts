import { InMemoryPromptService } from './inMemoryPromptService';
import { runPromptsServiceTests } from './prompts.test';

describe('InMemoryPromptService', () => {
    runPromptsServiceTests(() => new InMemoryPromptService());
});
