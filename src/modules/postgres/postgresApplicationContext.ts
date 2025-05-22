import { db } from '#modules/postgres/db';
import { PostgresCodeReviewService } from '#modules/postgres/postgresCodeReviewService';
import { PostgresLlmCallService } from '#modules/postgres/postgresLlmCallService';
import { PostgresPromptsService } from '#modules/postgres/postgresPromptsService';
import { PostgresVibeRepository } from '#modules/postgres/postgresVibeRespository';
import { ensureUsersTableExists } from '#modules/postgres/schemaUtils';
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
		llmCallService: new PostgresLlmCallService(),
		functionCacheService: new PostgresFunctionCacheService(),
		codeReviewService: new PostgresCodeReviewService(),
		promptsService: new PostgresPromptsService(),
		vibeRepository: new PostgresVibeRepository(),
		init: async () => {
			await ensureUsersTableExists(db);
		},
	};
}
