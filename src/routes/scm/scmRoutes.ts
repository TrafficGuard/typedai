import { type Static, Type } from '@sinclair/typebox';
import * as HttpStatus from 'http-status-codes';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest, sendJSON, sendServerError } from '#fastify/responses';
import type { SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';
import type { GitProject } from '#shared/model/git.model';
import { getFunctionsByType } from '../../functionRegistry';

// Define a type for the structured project response
interface ScmProjectResponseItem extends GitProject {
	type: string;
}

/**
 * Defines routes related to Source Control Management (SCM) operations.
 * @param fastify - The Fastify instance.
 */
export async function scmRoutes(fastify: AppFastifyInstance) {
	// Define the response schema for /api/scm/projects
	const GetProjectsResponseSchema = Type.Array(
		Type.Object({
			type: Type.String(),
			id: Type.Number(),
			name: Type.String(),
			namespace: Type.String(),
			fullPath: Type.String(),
			description: Type.Union([Type.String(), Type.Null()]),
			defaultBranch: Type.String(),
		}),
	);

	fastify.get(
		'/api/scm/projects',
		{
			schema: {
				response: {
					[HttpStatus.OK]: Type.Object({
						statusCode: Type.Number(),
						data: GetProjectsResponseSchema,
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
			try {
				logger.info('Fetching SCM projects');
				const allProjects: ScmProjectResponseItem[] = []; // Changed type
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
							// Map projects to the new structured format including the provider type
							return projects.map((project) => ({
								type: providerType,
								...project,
							}));
						} catch (error) {
							logger.error(error, `Error fetching projects for ${providerType}`);
							throw new Error(`Failed to fetch projects from ${providerType}. ${error.message}`);
						}
					}),
				);

				// Process results, adding successfully fetched projects to the list
				let getProjectsError = false;
				results.forEach((result, index) => {
					const providerType = scms[index].getScmType();
					if (result.status === 'fulfilled') {
						allProjects.push(...result.value); // result.value is now ScmProjectResponseItem[]
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

				// Sort by fullPath for consistency
				allProjects.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
				sendJSON(reply, allProjects);
			} catch (e) {
				logger.error(e);
				return sendServerError(reply, e.message);
			}
		},
	);

	// ... rest of the file remains the same ...

	// Schema for the /api/scm/branches query parameters
	const GetBranchesQuerySchema = Type.Object({
		providerType: Type.String({ description: "The type of SCM provider, e.g., 'gitlab' or 'github'" }),
		projectId: Type.String({ description: 'The project identifier (numeric ID or path) specific to the provider' }),
	});
	type GetBranchesQueryType = Static<typeof GetBranchesQuerySchema>;

	fastify.get(
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
			const { providerType, projectId } = request.query;
			logger.info(`Fetching branches for ${providerType} project: ${projectId}`);

			try {
				// No need to parse, providerType and projectId are directly available
				const provider = getSCM(providerType);

				if (!provider) {
					logger.warn(`SCM provider type '${providerType}' is not configured or supported.`);
					return sendBadRequest(reply, `SCM provider '${providerType}' is not configured or supported.`);
				}

				// projectId might be a numeric ID or a path string, the provider handles it
				const branches = await provider.getBranches(projectId);
				branches.sort((a, b) => a.localeCompare(b));
				sendJSON(reply, branches);
			} catch (error) {
				logger.error(error, `Error fetching branches for ${providerType} project ${projectId}`);
				// Keep existing error handling, but adjust log message if needed
				if (error.message.includes('not configured or supported')) {
					return sendBadRequest(reply, error.message);
				}
				sendServerError(reply, `Internal Server Error while fetching branches for ${providerType} project ${projectId}.`);
			}
		},
	);
}

function getConfiguredSCMs(): SourceControlManagement[] {
	logger.info(`SMC types: ${getFunctionsByType('scm').length}`);

	return getFunctionsByType('scm').filter((scm) => (scm as SourceControlManagement).isConfigured());
}

function getSCM(scmType: string): SourceControlManagement | undefined {
	return getConfiguredSCMs().find((scm) => scm.getScmType() === scmType);
}
