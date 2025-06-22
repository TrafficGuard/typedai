import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function deleteCodeTaskRoute(fastify: AppFastifyInstance) {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.delete, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		try {
			await codeTaskService.deleteCodeTask(userId, codeTaskId);
			return reply.code(204).send();
		} catch (error: any) {
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found for deletion`);
			}
			fastify.log.error(error, `Error deleting Code task ${codeTaskId} for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to delete Code task');
		}
	});
}
