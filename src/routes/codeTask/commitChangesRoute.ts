import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendErrorResponse, sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import type { CommitChangesData } from '#shared/codeTask/codeTask.model';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function commitChangesRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.commitChanges, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const data = request.body as CommitChangesData; // Schema ensures commitTitle and commitMessage

		try {
			const result = await codeTaskService.commitChanges(userId, codeTaskId, data);
			return reply.sendJSON(result);
		} catch (error: any) {
			fastify.log.error(error, `Error committing changes for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
			}
			if (error.message?.includes('state')) {
				// HTTP 409 Conflict for state issues
				return sendErrorResponse(reply, 409, error.message || 'Cannot commit changes in current state');
			}
			if (error.message?.includes('Not Implemented')) {
				// HTTP 501 Not Implemented
				return sendErrorResponse(reply, 501, 'This feature is not yet implemented.');
			}
			return sendServerError(reply, error.message || 'Failed to commit changes');
		}
	});
}
