import type { ApplicationContext } from '../../app/applicationTypes';
import { PostgresFunctionCacheService } from './postgresFunctionCacheService';
import { PostgresUserService } from './postgresUserService';

export function postgresApplicationContext(): ApplicationContext {
	return {
		agentStateService: null,
		chatService: null,
		userService: new PostgresUserService(),
		llmCallService: null,
		functionCacheService: new PostgresFunctionCacheService(),
		codeReviewService: null,
		promptsService: null,
		vibeRepository: null,
	};
}
