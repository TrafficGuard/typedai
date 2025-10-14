import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendBadRequest, sendNotFound, sendServerError } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function getRepoBranchesRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.getRepoBranches, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const { providerType, projectId } = request.query;

		try {
			const branches = await codeTaskService.getBranchList(userId, codeTaskId, providerType, projectId);
			return reply.sendJSON(branches);
		} catch (error: any) {
			logger.error(error, `Error getting branches for codeTask ${codeTaskId}, repo ${projectId} (provider: ${providerType}), user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task or repository not found: ${error.message}`);
			}
			if (error.message?.includes('Unsupported SCM provider type')) {
				return sendBadRequest(reply, error.message);
			}
			return sendServerError(reply, error.message || 'Failed to get branch list');
		}
	});
}
