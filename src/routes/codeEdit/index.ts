import type { AppFastifyInstance } from '#app/applicationTypes';
import { getFileSystemTreeRoute } from './getFileSystemTreeRoute';
import { getFilesContentRoute } from './getFilesContentRoute';

export async function codeEditRoutes(fastify: AppFastifyInstance) {
	await getFileSystemTreeRoute(fastify);
	await getFilesContentRoute(fastify);
}
