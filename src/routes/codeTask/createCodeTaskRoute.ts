import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendBadRequest, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import type { CreateCodeTaskData } from '#shared/codeTask/codeTask.model';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function createCodeTaskRoute(fastify: AppFastifyInstance) {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.create, async (request, reply) => {
		const userId = currentUser().id;
		const {
			title,
			instructions,
			repositorySource,
			repositoryId: originalRepositoryIdFromRequest,
			repositoryName,
			targetBranch,
			workingBranch,
			createWorkingBranch,
			useSharedRepos,
		} = request.body;

		let effectiveRepositoryId = originalRepositoryIdFromRequest;

		if (!effectiveRepositoryId && repositoryName && (repositorySource === 'github' || repositorySource === 'gitlab')) {
			effectiveRepositoryId = repositoryName;
			fastify.log.info(`Code task creation: repositoryId was not provided for source '${repositorySource}', derived from repositoryName '${repositoryName}'.`);
		}

		if (!effectiveRepositoryId) {
			return sendBadRequest(
				reply,
				"repositoryId is required. If using GitHub/GitLab and repositoryId is not directly provided, ensure repositoryName is supplied in 'owner/repo' format to be used as a fallback.",
			);
		}

		try {
			const createData: CreateCodeTaskData = {
				title,
				instructions,
				repositorySource,
				repositoryId: effectiveRepositoryId,
				repositoryName: repositoryName ?? undefined,
				targetBranch,
				workingBranch,
				createWorkingBranch,
				useSharedRepos,
			};
			const newCodeTask = await codeTaskService.createCodeTask(userId, createData);
			return reply.sendJSON(newCodeTask);
		} catch (error: any) {
			fastify.log.error(error, `Error creating Code task for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to create Code task');
		}
	});
}
