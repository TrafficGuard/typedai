import type { ApplicationContext } from '#app/applicationTypes';
import { InMemoryAgentStateService } from '#modules/memory/inMemoryAgentStateService';
import { InMemoryChatService } from '#modules/memory/inMemoryChatService';
import { InMemoryCodeReviewService } from '#modules/memory/inMemoryCodeReviewService';
import { InMemoryFunctionCacheService } from '#modules/memory/inMemoryFunctionCacheService';
import { InMemoryLlmCallService } from '#modules/memory/inMemoryLlmCallService';
import { InMemoryPromptService } from '#modules/memory/inMemoryPromptService';
import { InMemoryUserService } from '#modules/memory/inMemoryUserService';
import { InMemoryVibeRepository } from '#modules/memory/inMemoryVibeRepository';

export function inMemoryApplicationContext(): ApplicationContext {
	return {
		agentStateService: new InMemoryAgentStateService(),
		chatService: new InMemoryChatService(),
		userService: new InMemoryUserService(),
		llmCallService: new InMemoryLlmCallService(),
		codeReviewService: new InMemoryCodeReviewService(),
		functionCacheService: new InMemoryFunctionCacheService(),
		promptsService: new InMemoryPromptService(),
		vibeRepository: new InMemoryVibeRepository(), // For Vibe we store the Repository
	};
}
