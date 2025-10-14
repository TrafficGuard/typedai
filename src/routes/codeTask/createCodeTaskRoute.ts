import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendBadRequest, sendServerError } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import type { CreateCodeTaskData } from '#shared/codeTask/codeTask.model';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function createCodeTaskRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.create, async (request, reply) => {
		const userId = currentUser().id;
		const {
			title,
			instructions,
			repositorySource,
			repositoryFullPath: repositoryFullPathFromRequest,
			repositoryName,
			targetBranch,
			workingBranch,
			createWorkingBranch,
			useSharedRepos,
		} = request.body;

		let effectiveRepositoryPath = repositoryFullPathFromRequest;

		if (!effectiveRepositoryPath && repositoryName && (repositorySource === 'github' || repositorySource === 'gitlab')) {
			effectiveRepositoryPath = repositoryName;
			logger.info(`Code task creation: repositoryFullPath was not provided for source '${repositorySource}', derived from repositoryName '${repositoryName}'.`);
		}

		if (!effectiveRepositoryPath) {
			return sendBadRequest(
				reply,
				"repositoryFullPath is required. If using GitHub/GitLab and repositoryFullPath is not directly provided, ensure repositoryName is supplied in 'owner/repo' format to be used as a fallback.",
			);
		}

		try {
			const createData: CreateCodeTaskData = {
				title,
				instructions,
				repositorySource,
				repositoryFullPath: effectiveRepositoryPath,
				repositoryName: repositoryName ?? undefined,
				targetBranch,
				workingBranch,
				createWorkingBranch,
				useSharedRepos,
			};
			const newCodeTask = await codeTaskService.createCodeTask(userId, createData);
			return reply.sendJSON(newCodeTask);
		} catch (error: any) {
			logger.error(error, `Error creating Code task for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to create Code task');
		}
	});
}
