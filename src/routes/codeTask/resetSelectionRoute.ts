import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendErrorResponse, sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function resetSelectionRoute(fastify: AppFastifyInstance) {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.resetSelection, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		try {
			await codeTaskService.resetFileSelection(userId, codeTaskId);
			return reply.sendJSON({ message: 'File selection reset accepted.' });
		} catch (error: any) {
			fastify.log.error(error, `Error resetting file selection for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, error.message);
			}
			if (error.message?.includes('state')) {
				// HTTP 409 Conflict for state issues
				reply.code(409);
				return reply.send({ error: error.message });
			}
			return sendServerError(reply, 'Failed to reset file selection');
		}
	});
}
