import type { ApplicationContext } from '#app/applicationTypes';
import { InMemoryDebateStateService } from '#modules/debate/inMemoryDebateStateService';
import { InMemoryAgentStateService } from '#modules/memory/inMemoryAgentStateService';
import { InMemoryChatService } from '#modules/memory/inMemoryChatService';
import { InMemoryCodeReviewService } from '#modules/memory/inMemoryCodeReviewService';
import { InMemoryCodeTaskRepository } from '#modules/memory/inMemoryCodeTaskRepository';
import { InMemoryFunctionCacheService } from '#modules/memory/inMemoryFunctionCacheService';
import { InMemoryLlmCallService } from '#modules/memory/inMemoryLlmCallService';
import { InMemoryPromptService } from '#modules/memory/inMemoryPromptService';
import { InMemoryUserService } from '#modules/memory/inMemoryUserService';

export function inMemoryApplicationContext(): ApplicationContext {
	const ctx = {
		agentStateService: new InMemoryAgentStateService(),
		chatService: new InMemoryChatService(),
		userService: new InMemoryUserService(),
		llmCallService: new InMemoryLlmCallService(),
		codeReviewService: new InMemoryCodeReviewService(),
		functionCacheService: new InMemoryFunctionCacheService(),
		promptsService: new InMemoryPromptService(),
		codeTaskRepository: new InMemoryCodeTaskRepository(), // For CodeTask we store the Repository
		debateStateService: new InMemoryDebateStateService(),
		init: async () => {
			await ctx.userService.ensureSingleUser();
		},
	};
	return ctx;
}
