import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendNotFound, sendServerError } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function executeDesignRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.executeDesign, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		try {
			await codeTaskService.executeDesign(userId, codeTaskId);
			return reply.sendJSON({ message: 'Design execution accepted and processing started.' });
		} catch (error: any) {
			logger.error(error, `Error triggering design execution for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
			}
			return sendServerError(reply, error.message || 'Failed to trigger design execution');
		}
	});
}
