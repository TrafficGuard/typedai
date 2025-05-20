import type { ApplicationContext } from '../../app/applicationTypes';

export function postgresApplicationContext(): ApplicationContext {
	return {
		agentStateService: null,
		chatService: null,
		userService: null,
		llmCallService: null,
		functionCacheService: null,
		codeReviewService: null,
		promptsService: null,
		vibeRepository: null,
	};
}
