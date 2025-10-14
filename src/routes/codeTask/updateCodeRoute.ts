import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendNotFound, sendServerError } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function updateCodeRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.updateCode, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const data = request.body;

		try {
			await codeTaskService.updateCodeWithComments(userId, codeTaskId, data);
			return reply.sendJSON({});
		} catch (error: any) {
			logger.error(error, `Error triggering code update for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
			return sendServerError(reply, error.message || 'Failed to trigger code update');
		}
	});
}
