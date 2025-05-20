import type { ApplicationContext } from '../../app/applicationTypes';
import { PostgresFunctionCacheService } from './postgresFunctionCacheService';

export function postgresApplicationContext(): ApplicationContext {
	return {
		agentStateService: null,
		chatService: null,
		userService: null,
		llmCallService: null,
		functionCacheService: new PostgresFunctionCacheService(),
		codeReviewService: null,
		promptsService: null,
		vibeRepository: null,
	};
}
