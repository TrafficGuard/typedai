import type { AppFastifyInstance } from '#app/applicationTypes';
import { getFileSystemTreeRoute } from './getFileSystemTreeRoute';

export async function codeEditRoutes(fastify: AppFastifyInstance) {
	await getFileSystemTreeRoute(fastify);
}
