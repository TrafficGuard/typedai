import { AgentStateService } from '#agent/agentStateService/agentStateService';
import { ChatService } from '#chat/chatTypes';
import { TypeBoxFastifyInstance } from '#fastify/fastifyApp';
import { LlmCallService } from '#llm/llmCallService/llmCallService';
import { CodeReviewService } from '#swe/codeReview/codeReviewService';
import { UserService } from '#user/userService/userService';
import { FunctionCacheService } from './cache/functionCacheService';

export interface ApplicationContext {
	agentStateService: AgentStateService;
	userService: UserService;
	chatService: ChatService;
	llmCallService: LlmCallService;
	functionCacheService: FunctionCacheService;
	codeReviewService: CodeReviewService;
}

export interface AppFastifyInstance extends TypeBoxFastifyInstance, ApplicationContext {}
