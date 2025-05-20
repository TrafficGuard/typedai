import type { ApplicationContext } from '../../app/applicationTypes';
import { PostgresAgentStateService } from './postgresAgentStateService';
import { PostgresChatService } from './postgresChatService';
import { PostgresFunctionCacheService } from './postgresFunctionCacheService';
import { PostgresUserService } from './postgresUserService';

export function postgresApplicationContext(): ApplicationContext {
	return {
		agentStateService: new PostgresAgentStateService(),
		chatService: new PostgresChatService(),
		userService: new PostgresUserService(),
		llmCallService: null,
		functionCacheService: new PostgresFunctionCacheService(),
		codeReviewService: null,
		promptsService: null,
		vibeRepository: null,
	};
}
