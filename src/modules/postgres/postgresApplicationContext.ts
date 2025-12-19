import type { ApplicationContext } from '#app/applicationTypes';
import { db } from '#modules/postgres/db';
import { PostgresCodeReviewService } from '#modules/postgres/postgresCodeReviewService';
import { PostgresCodeTaskRepository } from '#modules/postgres/postgresCodeTaskRepository';
import { PostgresLlmCallService } from '#modules/postgres/postgresLlmCallService';
import { PostgresPromptsService } from '#modules/postgres/postgresPromptsService';
import { ensureAllTablesExist, ensureUsersTableExists } from '#modules/postgres/schemaUtils';
import { ensurePostgresDockerRunning } from './ensureDockerPostgres';
import { PostgresAgentStateService } from './postgresAgentStateService';
import { PostgresChatService } from './postgresChatService';
import { PostgresDebateStateService } from './postgresDebateStateService';
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
		codeTaskRepository: new PostgresCodeTaskRepository(),
		debateStateService: new PostgresDebateStateService(),
		init: async () => {
			await ensurePostgresDockerRunning();
			await ensureAllTablesExist(db);
		},
	};
}
