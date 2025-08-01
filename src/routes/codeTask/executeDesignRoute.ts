import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendErrorResponse, sendNotFound, sendServerError } from '#fastify/responses';
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
			fastify.log.error(error, `Error triggering design execution for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
			}
			if (error.message?.includes('state') || error.message?.includes('design')) {
				// HTTP 409 Conflict for state issues
				reply.code(409);
				return reply.send({ error: error.message || 'Cannot execute design in current state or no design available' });
			}
			return sendServerError(reply, error.message || 'Failed to trigger design execution');
		}
	});
}
