import type { AppFastifyInstance } from '#app/applicationTypes';
import { getFileSystemTreeRoute } from './getFileSystemTreeRoute';
import { getFilesContentRoute } from './getFilesContentRoute';

export async function codeEditRoutes(fastify: AppFastifyInstance) {
	// Register the file system tree route
	await getFileSystemTreeRoute(fastify);
	// Register the files content route
	await getFilesContentRoute(fastify);
	// Future routes for the 'code-edit' feature can be registered here.
}
