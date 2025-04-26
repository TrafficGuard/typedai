import type { AgentStateService } from '#agent/agentStateService/agentStateService';
import type { ChatService } from '#chat/chatTypes';
import type { TypeBoxFastifyInstance } from '#fastify/fastifyApp';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import type { UserService } from '#user/userService/userService';
import type { VibeService } from '#vibe/vibeTypes'; // Import VibeService
import type { FunctionCacheService } from './cache/functionCacheService';

export interface ApplicationContext {
	agentStateService: AgentStateService;
	userService: UserService;
	chatService: ChatService;
	llmCallService: LlmCallService;
	functionCacheService: FunctionCacheService;
	codeReviewService: CodeReviewService;
	vibeService: VibeService; // Add vibeService
}

export interface AppFastifyInstance extends TypeBoxFastifyInstance, ApplicationContext {}
