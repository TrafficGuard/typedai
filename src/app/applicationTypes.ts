import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import type { ChatService } from '#chat/chatService';
import type { CodeTaskRepository } from '#codeTask/codeTaskRepository';
import type { TypeBoxFastifyInstance } from '#fastify/fastifyApp';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import type { PromptsService } from '#prompts/promptsService';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import type { UserService } from '#user/userService';
import type { FunctionCacheService } from '../cache/functionCacheService';

export interface ApplicationContext {
	agentStateService: AgentContextService;
	userService: UserService;
	chatService: ChatService;
	llmCallService: LlmCallService;
	functionCacheService: FunctionCacheService;
	codeReviewService: CodeReviewService;
	codeTaskRepository: CodeTaskRepository; // For CodeTask we store the Repository
	promptsService: PromptsService;
	init?: () => Promise<void>;
}

export interface AppFastifyInstance extends TypeBoxFastifyInstance, ApplicationContext {}
