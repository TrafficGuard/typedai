import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendBadRequest, sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import type { UpdateCodeTaskData } from '#shared/codeTask/codeTask.model';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function updateCodeTaskRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.update, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const updates = request.body as UpdateCodeTaskData; // Body is already validated by schema

		if (Object.keys(updates).length === 0) {
			return sendBadRequest(reply, 'Update payload cannot be empty');
		}

		try {
			await codeTaskService.updateCodeTask(userId, codeTaskId, updates);
			// As per CODE_TASK_API.update, response is 204 No Content
			return reply.code(204).send();
		} catch (error: any) {
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found for update`);
			}
			fastify.log.error(error, `Error updating Code task ${codeTaskId} for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to update Code task');
		}
	});
}
