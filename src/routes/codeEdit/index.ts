import type { AppFastifyInstance } from '#app/applicationTypes';
import { getFileSystemTreeRoute } from './getFileSystemTreeRoute';

export async function codeEditRoutes(fastify: AppFastifyInstance) {
	// Register the file system tree route
	await getFileSystemTreeRoute(fastify);
	// Future routes for the 'code-edit' feature can be registered here.
}
