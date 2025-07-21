import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendErrorResponse, sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function updateDesignPromptRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.updateDesignPrompt, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const { prompt } = request.body; // Body is UpdateDesignPromptDataApiSchema { prompt: string }

		// Prompt presence is validated by schema

		try {
			await codeTaskService.updateDesignFromInstructions(userId, codeTaskId, prompt);
			return reply.sendJSON({ message: 'Design update from prompt accepted and processing started.' });
		} catch (error: any) {
			fastify.log.error(error, `Error triggering design update via prompt for codeTask ${codeTaskId}, user ${userId}`);
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
