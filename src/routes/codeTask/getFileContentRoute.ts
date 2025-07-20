import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function getFileContentRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.getFileContent, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const { path: filePath } = request.query; // path is required by schema

		try {
			const content = await codeTaskService.getFileContent(userId, codeTaskId, filePath);
			return reply.sendJSON({ content });
		} catch (error: any) {
			fastify.log.error(error, `Error getting file content for codeTask ${codeTaskId} (path: ${filePath}), user ${userId}`);
			if (error.message?.includes('not found') || error.name === 'ENOENT' /* For fs errors */) {
				return sendNotFound(reply, `File or CodeTask not found: ${filePath}`);
			}
			// Add more specific error handling if service throws typed errors
			return sendServerError(reply, error.message || 'Failed to get file content');
		}
	});
}
