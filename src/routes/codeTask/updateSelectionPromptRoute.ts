import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendErrorResponse, sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function updateSelectionPromptRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.updateSelectionPrompt, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const { prompt } = request.body;

		// Prompt presence is validated by the schema in CODE_TASK_API

		try {
			await codeTaskService.updateSelectionWithPrompt(userId, codeTaskId, prompt);
			return reply.sendJSON({ message: 'File selection update accepted and processing started.' });
		} catch (error: any) {
			fastify.log.error(error, `Error triggering file selection update for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
			}
			// if (error.message?.includes('state')) {
			// 	// HTTP 409 Conflict for state issues
			// 	reply.code(409);
			// 	return reply.send({ error: error.message || 'Cannot update selection in current state' });
			// }
			return sendServerError(reply, error.message || 'Failed to trigger file selection update');
		}
	});
}
