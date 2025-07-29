import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function listPresetsRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.listPresets, async (request, reply) => {
		const userId = currentUser().id;
		try {
			const presets = await codeTaskService.listCodeTaskPresets(userId);
			return reply.sendJSON(presets);
		} catch (error: any) {
			fastify.log.error(error, `Error listing Code task presets for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to list Code task presets');
		}
	});
}
