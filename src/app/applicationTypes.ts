import type { AgentContextService } from '#agent/agentContextService/agentContextService';
import type { ChatService } from '#chat/chatService';
import type { TypeBoxFastifyInstance } from '#fastify/fastifyApp';
import type { LlmCallService } from '#llm/llmCallService/llmCallService';
import type { CodeReviewService } from '#swe/codeReview/codeReviewService';
import type { UserService } from '#user/userService';
import type { VibeRepository } from '#vibe/vibeRepository';
import type { FunctionCacheService } from '../cache/functionCacheService';
import type { PromptsService } from '../prompts/promptService';
// PromptsService import will be added by the next block if not already present by auto-formatter
// or if it was missed in the SEARCH part. Assuming it's not there for a clean addition.
// For the sake of this block, let's assume PromptsService import is handled separately or already there.

export interface ApplicationContext {
	agentStateService: AgentContextService;
	userService: UserService;
	chatService: ChatService;
	llmCallService: LlmCallService;
	functionCacheService: FunctionCacheService;
	codeReviewService: CodeReviewService;
	vibeRepository: VibeRepository; // For Vibe we store the Repository
	promptsService: PromptsService;
}

export interface AppFastifyInstance extends TypeBoxFastifyInstance, ApplicationContext {}
