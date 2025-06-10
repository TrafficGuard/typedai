import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function createPresetRoute(fastify: AppFastifyInstance) {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.createPreset, async (request, reply) => {
		const userId = currentUser().id;
		const { name, config } = request.body;
		try {
			const newPreset = await codeTaskService.saveCodeTaskPreset(userId, name, config);
			return reply.sendJSON(newPreset);
		} catch (error: any) {
			fastify.log.error(error, `Error creating Code task preset for user ${userId}`);
			return sendServerError(reply, error.message || 'Failed to create Code task preset');
		}
	});
}
