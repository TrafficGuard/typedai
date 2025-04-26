import * as HttpStatus from 'http-status-codes';
import type { AppFastifyInstance } from '#applicationTypes';
import { sendSuccess } from '#fastify/responses';
import type { GitProject } from '#functions/scm/gitProject';
import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import { logger } from '#o11y/logger';

/**
 * Defines routes related to Source Control Management (SCM) operations.
 * @param fastify - The Fastify instance.
 */
export async function vibeScmRoutes(fastify: AppFastifyInstance): Promise<void> {
	fastify.get('/api/scm/projects', async (request, reply) => {
		logger.info('Fetching SCM projects');
		const allProjects: string[] = [];
		const github = new GitHub();
		const gitlab = new GitLab();

		if (github.isConfigured()) {
			try {
				logger.info('Fetching GitHub projects');
				const githubProjects: GitProject[] = await github.getProjects();
				githubProjects.forEach((project) => allProjects.push(`GitHub: ${project.fullPath}`));
			} catch (error) {
				logger.error(error, 'Error fetching GitHub projects');
				// Continue execution even if GitHub fetch fails
			}
		} else {
			logger.info('GitHub SCM provider not configured');
		}

		if (gitlab.isConfigured()) {
			try {
				logger.info('Fetching GitLab projects');
				const gitlabProjects: GitProject[] = await gitlab.getProjects();
				gitlabProjects.forEach((project) => allProjects.push(`GitLab: ${project.fullPath}`));
			} catch (error) {
				logger.error(error, 'Error fetching GitLab projects');
				// Continue execution even if GitLab fetch fails
			}
		} else {
			logger.info('GitLab SCM provider not configured');
		}

		if (allProjects.length === 0 && !github.isConfigured() && !gitlab.isConfigured()) {
			logger.warn('No SCM providers are configured');
			return reply.code(HttpStatus.BAD_REQUEST).send({ message: 'No SCM provider configured.' });
		}

		try {
			allProjects.sort((a, b) => a.localeCompare(b));
			// Use sendSuccess with the combined and sorted list
			// The second argument to sendSuccess is the data payload
			sendSuccess(reply, allProjects as any); // Cast needed as sendSuccess expects string message by default
		} catch (error) {
			logger.error(error, 'Error processing or sending SCM projects');
			reply.code(HttpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Internal Server Error while processing projects.' });
		}
	});

	// Add other SCM-related routes here (e.g., get project details, create merge request)
	logger.info('Registered vibe SCM routes');
}
