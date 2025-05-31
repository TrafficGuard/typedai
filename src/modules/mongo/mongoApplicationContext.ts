import type { ApplicationContext } from '#app/applicationTypes';

// Service Interface Imports
import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import type { FunctionCacheService } from '#cache/functionCacheService';
import type { ChatService } from '#chat/chatService';
import type { CodeTaskRepository } from '#codeTask/codeTaskRepository';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import type { PromptsService } from '#prompts/promptsService';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import type { UserService } from '#user/userService';

// Mongo Service Implementation Imports (Placeholders for files to be created in src/modules/mongo/)
import { MongoAgentContextService } from '#mongo/MongoAgentContextService'; // Placeholder: File src/modules/mongo/MongoAgentContextService.ts will be created later
import { MongoChatService } from '#mongo/MongoChatService'; // Placeholder: File src/modules/mongo/MongoChatService.ts will be created later
import { MongoCodeReviewService } from '#mongo/MongoCodeReviewService'; // Placeholder: File src/modules/mongo/MongoCodeReviewService.ts will be created later
import { MongoCodeTaskRepository } from '#mongo/MongoCodeTaskRepository'; // Placeholder: File src/modules/mongo/MongoCodeTaskRepository.ts will be created later
import { MongoFunctionCacheService } from '#mongo/MongoFunctionCacheService'; // Placeholder: File src/modules/mongo/MongoFunctionCacheService.ts will be created later
import { MongoLlmCallService } from '#mongo/MongoLlmCallService'; // Placeholder: File src/modules/mongo/MongoLlmCallService.ts will be created later
import { MongoPromptsService } from '#mongo/MongoPromptsService'; // Placeholder: File src/modules/mongo/MongoPromptsService.ts will be created later
import { MongoUserService } from '#mongo/MongoUserService'; // Placeholder: File src/modules/mongo/MongoUserService.ts will be created later

export function mongoApplicationContext(): ApplicationContext {
	return {
		agentStateService: new MongoAgentContextService(), // TODO: Implement MongoAgentContextService and ensure it's exported from '#mongo/MongoAgentContextService.ts',
		userService: new MongoUserService(), // TODO: Implement MongoUserService and ensure it's exported from '#mongo/MongoUserService.ts',
		chatService: new MongoChatService(), // TODO: Implement MongoChatService and ensure it's exported from '#mongo/MongoChatService.ts',
		llmCallService: new MongoLlmCallService(), // TODO: Implement MongoLlmCallService and ensure it's exported from '#mongo/MongoLlmCallService.ts',
		functionCacheService: new MongoFunctionCacheService(), // TODO: Implement MongoFunctionCacheService and ensure it's exported from '#mongo/MongoFunctionCacheService.ts',
		codeReviewService: new MongoCodeReviewService(), // TODO: Implement MongoCodeReviewService and ensure it's exported from '#mongo/MongoCodeReviewService.ts',
		codeTaskRepository: new MongoCodeTaskRepository(), // TODO: Implement MongoCodeTaskRepository and ensure it's exported from '#mongo/MongoCodeTaskRepository.ts',
		promptsService: new MongoPromptsService(), // TODO: Implement MongoPromptsService and ensure it's exported from '#mongo/MongoPromptsService.ts'
	};
}
