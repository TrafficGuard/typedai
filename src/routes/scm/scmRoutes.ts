import { type Static, Type } from '@sinclair/typebox';
import * as HttpStatus from 'http-status-codes';
import { sendBadRequest, sendJSON, sendServerError } from '#fastify/responses';
import type { GitProject } from '#functions/scm/gitProject';
import { parseScmProjectId } from '#functions/scm/scmUtils';
import type { SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';
import type { AppFastifyInstance } from '../../applicationTypes';
import { getFunctionsByType } from '../../functionRegistry';

/**
 * Defines routes related to Source Control Management (SCM) operations.
 * @param fastify - The Fastify instance.
 */
export async function scmRoutes(fastify: AppFastifyInstance): Promise<void> {
	fastify.get('/api/scm/projects', async (request, reply) => {
		try {
			logger.info('Fetching SCM projects');
			const allProjects: string[] = [];
			const scms = getConfiguredSCMs();

			if (!scms.length) {
				logger.warn('No SCM providers are configured');
				return sendBadRequest(reply, 'No SCM provider configured.');
			}

			// Use Promise.allSettled to fetch from all providers concurrently and handle potential errors
			const results = await Promise.allSettled(
				scms.map(async (provider: SourceControlManagement) => {
					const providerType = provider.getScmType();
					logger.info(`Fetching projects from ${providerType}`);
					try {
						const projects: GitProject[] = await provider.getProjects();
						// Prefix project paths with the provider type for clarity
						return projects.map((project) => `${providerType.charAt(0).toUpperCase() + providerType.slice(1)}: ${project.fullPath}`);
					} catch (error) {
						throw new Error(`Failed to fetch projects from ${providerType}`);
					}
				}),
			);

			// Process results, adding successfully fetched projects to the list
			let getProjectsError = false;
			results.forEach((result, index) => {
				const providerType = scms[index].getScmType();
				if (result.status === 'fulfilled') {
					allProjects.push(...result.value);
				} else {
					getProjectsError = true;
					logger.warn(result.reason, `Skipping projects from ${providerType} due to fetch error.`);
				}
			});

			// Check if any projects were successfully fetched after handling errors
			if (allProjects.length === 0 && getProjectsError) {
				logger.error('Failed to fetch projects from all configured SCM providers.');
				return sendServerError(reply, 'Failed to fetch projects from configured SCM providers.');
			}

			allProjects.sort((a, b) => a.localeCompare(b));
			sendJSON(reply, allProjects);
		} catch (e) {
			logger.error(e);
			return sendServerError(reply, e.message);
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
				const provider = getSCM(providerType);

				if (!provider) {
					logger.warn(`SCM provider type '${providerType}' derived from '${prefixedProjectId}' is not configured or supported.`);
					return sendBadRequest(reply, `SCM provider '${providerType}' is not configured or supported.`);
				}

				const branches = await provider.getBranches(projectId);
				branches.sort((a, b) => a.localeCompare(b));
				sendJSON(reply, branches);
			} catch (error) {
				logger.error(error, `Error fetching branches for project ${prefixedProjectId}`);
				if (error.message.includes('not configured or supported') || error.message.includes('Invalid project ID format')) {
					return sendBadRequest(reply, error.message);
				}
				sendServerError(reply, `Internal Server Error while fetching branches for ${prefixedProjectId}.`);
			}
		},
	);
}

function getConfiguredSCMs(): SourceControlManagement[] {
	logger.info(`SMC types: ${getFunctionsByType('scm').length}`);

	return (
		getFunctionsByType('scm')
			// .map((scm) => new scm() as SourceControlManagement)
			.filter((scm) => (scm as SourceControlManagement).isConfigured())
	);
}

function getSCM(scmType: string): SourceControlManagement | undefined {
	return getConfiguredSCMs().find((scm) => scm.getScmType() === scmType);
}
