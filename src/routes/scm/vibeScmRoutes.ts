import { type Static, Type } from '@sinclair/typebox';
import * as HttpStatus from 'http-status-codes';
import type { AppFastifyInstance } from '#applicationTypes';
import { sendBadRequest, sendSuccess } from '#fastify/responses';
import type { GitProject } from '#functions/scm/gitProject';
import { ScmService } from '#functions/scm/scmService';
import { parseScmProjectId } from '#functions/scm/scmUtils';
import type { SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';

/**
 * Defines routes related to Source Control Management (SCM) operations.
 * @param fastify - The Fastify instance.
 */
export async function vibeScmRoutes(fastify: AppFastifyInstance): Promise<void> {
	const scmService = new ScmService(); // Instantiate the service

	fastify.get('/api/scm/projects', async (request, reply) => {
		logger.info('Fetching SCM projects');
		const allProjects: string[] = [];
		const configuredProviders = scmService.getConfiguredProviders();

		if (!scmService.hasConfiguredProvider()) {
			logger.warn('No SCM providers are configured');
			return reply.code(HttpStatus.BAD_REQUEST).send({ message: 'No SCM provider configured.' });
		}

		// Use Promise.allSettled to fetch from all providers concurrently and handle potential errors
		const results = await Promise.allSettled(
			configuredProviders.map(async (provider: SourceControlManagement) => {
				const providerType = provider.getType();
				logger.info(`Fetching projects from ${providerType}`);
				try {
					const projects: GitProject[] = await provider.getProjects();
					// Prefix project paths with the provider type for clarity
					return projects.map((project) => `${providerType.charAt(0).toUpperCase() + providerType.slice(1)}: ${project.fullPath}`);
				} catch (error) {
					logger.error(error, `Error fetching projects from ${providerType}`);
					// Throw error to be caught by Promise.allSettled
					throw new Error(`Failed to fetch projects from ${providerType}`);
				}
			}),
		);

		// Process results, adding successfully fetched projects to the list
		results.forEach((result, index) => {
			const providerType = configuredProviders[index].getType();
			if (result.status === 'fulfilled') {
				allProjects.push(...result.value);
			} else {
				// Log the rejection reason, but continue processing other providers
				logger.error(result.reason, `Skipping projects from ${providerType} due to fetch error.`);
			}
		});

		// Check if any projects were successfully fetched after handling errors
		if (allProjects.length === 0) {
			logger.error('Failed to fetch projects from all configured SCM providers.');
			return reply.code(HttpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Failed to fetch projects from configured SCM providers.' });
		}

		try {
			allProjects.sort((a, b) => a.localeCompare(b));
			// sendSuccess expects a message string as the second argument by default.
			// To send data, pass null or an empty string for the message and put the data in the third argument (extra options).
			// However, the existing sendSuccess implementation seems designed to put the data directly in the second arg if it's not a string.
			// Let's adjust the call slightly to be clearer or potentially adjust sendSuccess if needed.
			// Assuming sendSuccess can handle an array directly based on previous usage:
			reply.code(HttpStatus.OK).send({ statusCode: HttpStatus.OK, data: allProjects });
			// If sendSuccess strictly needs a message:
			// sendSuccess(reply, 'Successfully fetched projects', { data: allProjects });
		} catch (error) {
			logger.error(error, 'Error sorting or sending SCM projects');
			reply.code(HttpStatus.INTERNAL_SERVER_ERROR).send({ message: 'Internal Server Error while processing projects.' });
		}
	});

	// Schema for the /api/scm/branches query parameters
	const GetBranchesQuerySchema = Type.Object({
		projectId: Type.String({ description: "Project identifier prefixed with provider type, e.g., 'GitLab:group/project' or 'GitHub:owner/repo'" }),
	});
	type GetBranchesQueryType = Static<typeof GetBranchesQuerySchema>;

	fastify.get<{ Querystring: GetBranchesQueryType }>(
		'/api/scm/branches',
		{
			schema: {
				querystring: GetBranchesQuerySchema,
				response: {
					[HttpStatus.OK]: Type.Object({
						statusCode: Type.Number(),
						data: Type.Array(Type.String()),
					}),
					[HttpStatus.BAD_REQUEST]: Type.Object({
						statusCode: Type.Number(),
						message: Type.String(),
					}),
					[HttpStatus.INTERNAL_SERVER_ERROR]: Type.Object({
						statusCode: Type.Number(),
						message: Type.String(),
					}),
				},
			},
		},
		async (request, reply) => {
			const { projectId: prefixedProjectId } = request.query;
			logger.info(`Fetching branches for project: ${prefixedProjectId}`);

			try {
				const { providerType, projectId } = parseScmProjectId(prefixedProjectId);
				const provider = scmService.getProvider(providerType);

				if (!provider) {
					logger.warn(`SCM provider type '${providerType}' derived from '${prefixedProjectId}' is not configured or supported.`);
					return sendBadRequest(reply, `SCM provider '${providerType}' is not configured or supported.`);
				}

				const branches = await provider.getBranches(projectId);
				branches.sort((a, b) => a.localeCompare(b));
				reply.code(HttpStatus.OK).send({ statusCode: HttpStatus.OK, data: branches });
			} catch (error) {
				logger.error(error, `Error fetching branches for project ${prefixedProjectId}`);
				if (error.message.includes('not configured or supported') || error.message.includes('Invalid project ID format')) {
					return sendBadRequest(reply, error.message);
				}
				reply.code(HttpStatus.INTERNAL_SERVER_ERROR).send({ message: `Internal Server Error while fetching branches for ${prefixedProjectId}.` });
			}
		},
	);

	// Add other SCM-related routes here (e.g., get project details, create merge request)
	logger.info('Registered vibe SCM routes');
}
