import * as HttpStatus from 'http-status-codes';
import type { AppFastifyInstance } from '#applicationTypes';
import { send, sendSuccess } from '#fastify/responses';
import { getSourceControlManagementTool } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';

/**
 * Defines routes related to Source Control Management (SCM) operations.
 * @param fastify - The Fastify instance.
 */
export async function vibeScmRoutes(fastify: AppFastifyInstance): Promise<void> {
	fastify.get('/api/scm/projects', async (request, reply) => {
		try {
			logger.info('Fetching SCM projects');
			const scmTool = getSourceControlManagementTool();
			if (!scmTool.isConfigured()) {
				logger.warn('SCM tool is not configured');
				return reply.code(HttpStatus.BAD_REQUEST).send({ message: 'SCM provider not configured.' });
			}
			const projects = await scmTool.getProjects();
			send(reply, HttpStatus.OK, projects);
		} catch (error) {
			logger.error(error, 'Error fetching SCM projects');
			// Check if the error message indicates no SCM tool was found
			if (error instanceof Error && error.message.includes('No function classes found which implement SourceControlManagement')) {
				return reply.code(HttpStatus.BAD_REQUEST).send({ message: 'No SCM provider configured or found.' });
			}
			reply.code(HttpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Internal Server Error while fetching projects.' });
		}
	});

	// Add other SCM-related routes here (e.g., get project details, create merge request)
	logger.info('Registered vibe SCM routes');
}
