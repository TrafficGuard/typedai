import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendServerError } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function listCodeTasksRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.list, async (request, reply) => {
		const userId = currentUser().id;
		try {
			const codeTasks = await codeTaskService.listCodeTasks(userId);
			return reply.sendJSON(codeTasks);
		} catch (error: any) {
			logger.error(error, `Error listing Code tasks for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to list Code tasks');
		}
	});
}
