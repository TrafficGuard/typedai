import { getFileSystem } from '#agent/agentContextLocalStorage';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendServerError } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CODE_EDIT_API, type FilesContentResponse } from '#shared/codeEdit/codeEdit.api';

/**
 * Registers the route for fetching the content of multiple files.
 * POST /api/code-edit/files-content
 */
export async function getFilesContentRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CODE_EDIT_API.getFilesContent, async (req, reply) => {
		const { filePaths } = req.body;
		const fss = getFileSystem();

		try {
			// Use the FileSystemService to read multiple files.
			const contentsMap = await fss.readFiles(filePaths);

			// Convert the Map to a plain object for the JSON response.
			const response: FilesContentResponse = Object.fromEntries(contentsMap);

			return await reply.sendJSON(response);
		} catch (error: any) {
			logger.error(error, 'Failed to get files content [error]');
			return sendServerError(reply, 'An error occurred while reading file contents.');
		}
	});
}
