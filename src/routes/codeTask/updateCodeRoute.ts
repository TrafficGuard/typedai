import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendErrorResponse, sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import type { UpdateCodeReviewData } from '#shared/codeTask/codeTask.model';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function updateCodeRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.updateCode, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const data = request.body; // Schema ensures reviewComments: string

		try {
			await codeTaskService.updateCodeWithComments(userId, codeTaskId, data);
			// API definition expects 202 with ApiNullResponseSchema.
			return reply.code(202).send(null); // ApiNullResponseSchema maps to null payload
		} catch (error: any) {
			fastify.log.error(error, `Error triggering code update for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
			}
			if (error.message?.includes('state')) {
				reply.code(409);
				return reply.send({ error: error.message || 'Cannot update code in current state' });
			}
			// Handle "Not Implemented" specifically if service throws it
			if (error.message?.includes('Not Implemented')) {
				// HTTP 501 Not Implemented
				reply.code(501);
				return reply.send({ error: 'This feature is not yet implemented.' });
			}
			return sendServerError(reply, error.message || 'Failed to trigger code update');
		}
	});
}
