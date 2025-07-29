import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendErrorResponse, sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function updateDesignRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.updateDesign, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const { design } = request.body; // Body is Type.Object({ design: Type.String() })

		// Design presence is validated by schema

		try {
			// The service method is updateDesign(userId, codeTaskId, prompt: string)
			// The API body is { design: string }. Assuming 'design' here means the 'prompt' or full design content.
			await codeTaskService.updateDesign(userId, codeTaskId, design);
			return reply.sendJSON({ message: 'Design update accepted and processing started.' });
		} catch (error: any) {
			fastify.log.error(error, `Error triggering design update for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
			}
			if (error.message?.includes('state')) {
				// HTTP 409 Conflict for state issues
				reply.code(409);
				return reply.send({ error: error.message || 'Cannot update design in current state' });
			}
			return sendServerError(reply, error.message || 'Failed to trigger design update');
		}
	});
}
