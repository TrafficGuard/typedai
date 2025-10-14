import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendNotFound, sendServerError } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function deletePresetRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.deletePreset, async (request, reply) => {
		const userId = currentUser().id;
		const { presetId } = request.params;
		// presetId presence is validated by schema
		try {
			await codeTaskService.deleteCodeTaskPreset(userId, presetId);
			return reply.code(204).send();
		} catch (error: any) {
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task preset with ID ${presetId} not found for deletion`);
			}
			logger.error(error, `Error deleting Code task preset ${presetId} for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to delete Code task preset');
		}
	});
}
