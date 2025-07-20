import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendServerError } from '#fastify/responses';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { CODE_EDIT_API } from '#shared/codeEdit/codeEdit.api';
import { registerApiRoute } from '../routeUtils';

export async function getFileSystemTreeRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, CODE_EDIT_API.getFileSystemTree, async (request, reply) => {
		try {
			const fss = new FileSystemService(process.cwd());
			const tree = await fss.getFileSystemNodes();

			if (!tree) {
				return sendServerError(reply, 'Could not generate file system tree.');
			}

			return reply.sendJSON(tree);
		} catch (error: any) {
			fastify.log.error(error, 'Error getting file system tree for code-edit');
			return sendServerError(reply, error.message || 'Failed to get file system tree');
		}
	});
}
