import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function getCodeTaskByIdRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.getById, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		try {
			const codeTask = await codeTaskService.getCodeTask(userId, codeTaskId);
			if (!codeTask) return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);

			return reply.sendJSON(codeTask);
		} catch (error: any) {
			fastify.log.error(error, `Error getting Code task ${codeTaskId} for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to retrieve Code task');
		}
	});
}
