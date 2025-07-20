import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function getFileSystemTreeRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.getFileSystemTree, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		const { path } = request.query; // path is optional

		try {
			const tree = await codeTaskService.getFileSystemTree(userId, codeTaskId, path);
			if (!tree) {
				// This case might occur if the root path itself is invalid or inaccessible,
				// though FileSystemService might throw before this.
				return sendNotFound(reply, `File system tree not found for path: ${path || '/'}`);
			}
			return reply.sendJSON(tree);
		} catch (error: any) {
			fastify.log.error(error, `Error getting file system tree for codeTask ${codeTaskId} (path: ${path || '/'}), user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task or path not found: ${error.message}`);
			}
			// Add more specific error handling if service throws typed errors for state issues
			return sendServerError(reply, error.message || 'Failed to get file system tree');
		}
	});
}
