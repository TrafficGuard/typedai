import { type Static, Type } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#applicationTypes';
import type { FastifyRequest } from '#fastify/fastifyApp';
import type { GitProject } from '#functions/scm/gitProject';
import type { CreateVibeSessionData, VibeSession } from '#vibe/vibeTypes';

// Define a TypeBox schema for the response (subset of VibeSession)
// Note: Firestore returns Timestamps, which might need conversion or specific handling
// For simplicity, let's assume they are handled/serializable or define a simpler schema for the API response.
const VibeSessionListResponseSchema = Type.Array(
	Type.Object({
		id: Type.String(),
		title: Type.String(),
		status: Type.String(), // Consider using Type.Union if statuses are fixed
		createdAt: Type.Any(), // Use Type.Any() or a more specific schema if serialization is handled (e.g., Type.String() for ISO string)
		// Add other fields if needed by the frontend list view
	}),
);

// Define a schema for error responses
const ErrorResponseSchema = Type.Object({
	error: Type.String(),
});

// Schema for the request body of the create endpoint
const CreateVibeSessionRequestSchema = Type.Object({
	title: Type.String(),
	instructions: Type.String(),
	repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
	repositoryId: Type.String(),
	repositoryName: Type.Optional(Type.Union([Type.String(), Type.Null()])), // Optional field, can be string or null
	branch: Type.String(),
	newBranchName: Type.Optional(Type.Union([Type.String(), Type.Null()])), // Optional field, can be string or null
	useSharedRepos: Type.Boolean(),
});

// Schema for the successful response of the create endpoint
const VibeSessionResponseSchema = Type.Object({
	id: Type.String(),
	userId: Type.String(),
	title: Type.String(),
	instructions: Type.String(),
	repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
	repositoryId: Type.String(),
	repositoryName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	branch: Type.String(),
	newBranchName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	useSharedRepos: Type.Boolean(),
	status: Type.Union([
		Type.Literal('initializing'),
		Type.Literal('design'),
		Type.Literal('coding'),
		Type.Literal('review'),
		Type.Literal('completed'),
		Type.Literal('error'),
	]),
	fileSelection: Type.Optional(Type.Array(Type.Object({ filePath: Type.String(), readOnly: Type.Optional(Type.Boolean()) }))),
	designAnswer: Type.Optional(Type.String()),
	createdAt: Type.Any(), // Firestore timestamp, serialized differently depending on context
	updatedAt: Type.Any(), // Firestore timestamp
	error: Type.Optional(Type.String()),
});

// Schema for SCM Provider response
const ScmProviderSchema = Type.Object({
	type: Type.String(),
	// Add other relevant provider details if needed
});
const ScmProviderListResponseSchema = Type.Array(ScmProviderSchema);

// Schema for GitProject response
const GitProjectSchema = Type.Object({
	id: Type.Union([Type.String(), Type.Number()]), // GitLab uses number, GitHub might use string or number depending on context
	name: Type.String(),
	namespace: Type.String(),
	fullPath: Type.String(),
	description: Type.Union([Type.String(), Type.Null()]),
	defaultBranch: Type.String(),
	// Add other relevant project details if needed
});
const GitProjectListResponseSchema = Type.Array(GitProjectSchema);

// Schema for Branch list response
const BranchListResponseSchema = Type.Array(Type.String());

export async function vibeRoutes(fastify: AppFastifyInstance) {
	// Access services from the application context attached to fastify
	const vibeService = fastify.vibeService;
	const scmService = fastify.scmService;

	// --- GET /sessions ---
	fastify.get(
		'/sessions',
		{
			schema: {
				// Add response schema for validation and documentation
				response: {
					200: VibeSessionListResponseSchema,
					401: ErrorResponseSchema, // Add schema for 401
				},
			},
		},
		// Explicitly type the request parameter
		async (request: FastifyRequest, reply) => {
			// Assuming authentication middleware adds `currentUser` to the request
			if (!request.currentUser?.id) {
				return reply.code(401).send({ error: 'Unauthorized' });
			} // <-- Added missing closing brace

			// Get userId from the authenticated user
			const userId = request.currentUser.id;
			// Use the injected service
			const sessions = await vibeService.listVibeSessions(userId);

			// Optional: Map sessions to the response schema if needed (e.g., timestamp conversion)
			// Note: Timestamps might need serialization depending on how Firestore/InMemory returns them
			// const responseSessions = sessions.map(session => ({
			//     id: session.id,
			//     title: session.title,
			//     status: session.status,
			//     createdAt: session.createdAt.toDate().toISOString(), // Example conversion
			// }));

			return reply.send(sessions); // Send the raw sessions or the mapped responseSessions
		},
	);

	// --- POST /create ---
	fastify.post(
		'/create',
		{
			schema: {
				body: CreateVibeSessionRequestSchema,
				response: {
					201: VibeSessionResponseSchema,
					400: ErrorResponseSchema, // For validation errors
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest, reply) => {
			// Check for authenticated user
			if (!request.currentUser?.id) {
				return reply.code(401).send({ error: 'Unauthorized' });
			}
			const userId = request.currentUser.id;

			// Extract validated request body
			const sessionData = request.body as Static<typeof CreateVibeSessionRequestSchema>;

			// Map request data to the service layer type
			const createData: CreateVibeSessionData = {
				title: sessionData.title,
				instructions: sessionData.instructions,
				repositorySource: sessionData.repositorySource,
				repositoryId: sessionData.repositoryId,
				repositoryName: sessionData.repositoryName ?? undefined, // Handle optional null -> undefined
				branch: sessionData.branch,
				newBranchName: sessionData.newBranchName ?? undefined, // Handle optional null -> undefined
				useSharedRepos: sessionData.useSharedRepos,
				// fileSelection is not part of the creation payload based on CreateVibeSessionData
			};

			try {
				// Use the injected service
				const newSession = await vibeService.createVibeSession(userId, createData);
				// Return the newly created session with status 201
				// Note: Timestamps might need serialization depending on how Firestore/InMemory returns them
				return reply.code(201).send(newSession);
			} catch (error) {
				// Log the error and return a 500 response
				fastify.log.error(error, 'Error creating Vibe session');
				return reply.code(500).send({ error: 'Failed to create Vibe session' });
			}
		},
	);

	// --- GET /scm/providers ---
	fastify.get(
		'/scm/providers',
		{
			schema: {
				response: {
					200: ScmProviderListResponseSchema,
					401: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest, reply) => {
			if (!request.currentUser?.id) {
				return reply.code(401).send({ error: 'Unauthorized' });
			}

			const providers = scmService.getConfiguredProviders();
			const response = providers.map((p) => ({ type: p.getType() })); // Map to the response schema
			return reply.send(response);
		},
	);

	// --- GET /scm/projects ---
	fastify.get(
		'/scm/projects',
		{
			schema: {
				querystring: Type.Object({
					providerType: Type.String({ description: "The type of SCM provider (e.g., 'github', 'gitlab')" }),
				}),
				response: {
					200: GitProjectListResponseSchema,
					400: ErrorResponseSchema, // For missing/invalid providerType
					401: ErrorResponseSchema,
					404: ErrorResponseSchema, // Provider not found/configured
					500: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest<{ Querystring: { providerType: string } }>, reply) => {
			if (!request.currentUser?.id) {
				return reply.code(401).send({ error: 'Unauthorized' });
			}

			const { providerType } = request.query;
			if (!providerType) {
				return reply.code(400).send({ error: 'Missing providerType query parameter' });
			}

			const provider = scmService.getProvider(providerType);
			if (!provider) {
				return reply.code(404).send({ error: `SCM provider '${providerType}' not found or not configured.` });
			}

			try {
				const projects: GitProject[] = await provider.getProjects();
				// Map projects to ensure they fit the GitProjectSchema, especially the 'id' type
				const responseProjects = projects.map((p) => ({
					id: p.id, // Keep original type (string | number)
					name: p.name,
					namespace: p.namespace,
					fullPath: p.fullPath,
					description: p.description,
					defaultBranch: p.defaultBranch,
				}));
				return reply.send(responseProjects);
			} catch (error) {
				fastify.log.error(error, `Error fetching projects for provider ${providerType}`);
				return reply.code(500).send({ error: 'Failed to fetch projects' });
			}
		},
	);

	// --- GET /scm/branches ---
	fastify.get(
		'/scm/branches',
		{
			schema: {
				querystring: Type.Object({
					providerType: Type.String({ description: "The type of SCM provider (e.g., 'github', 'gitlab')" }),
					projectId: Type.Union([Type.String(), Type.Number()], { description: 'The ID or path of the project' }),
				}),
				response: {
					200: BranchListResponseSchema,
					400: ErrorResponseSchema, // For missing parameters
					401: ErrorResponseSchema,
					404: ErrorResponseSchema, // Provider or project not found
					500: ErrorResponseSchema,
				},
			},
		},
		async (request: FastifyRequest<{ Querystring: { providerType: string; projectId: string | number } }>, reply) => {
			if (!request.currentUser?.id) {
				return reply.code(401).send({ error: 'Unauthorized' });
			}

			const { providerType, projectId } = request.query;
			if (!providerType || projectId === undefined) {
				// Check for undefined specifically as 0 is a valid GitLab ID
				return reply.code(400).send({ error: 'Missing providerType or projectId query parameter' });
			}

			const provider = scmService.getProvider(providerType);
			if (!provider) {
				return reply.code(404).send({ error: `SCM provider '${providerType}' not found or not configured.` });
			}

			try {
				// Ensure projectId is passed correctly (might be string or number)
				const branches = await provider.getBranches(projectId);
				return reply.send(branches);
			} catch (error: any) {
				// Basic check for project not found errors (might need refinement based on specific SCM errors)
				if (error.message?.includes('404') || error.message?.toLowerCase().includes('not found')) {
					fastify.log.warn(`Project not found for provider ${providerType}, projectId ${projectId}`);
					return reply.code(404).send({ error: `Project with ID/Path '${projectId}' not found for provider '${providerType}'.` });
				}
				fastify.log.error(error, `Error fetching branches for provider ${providerType}, projectId ${projectId}`);
				return reply.code(500).send({ error: 'Failed to fetch branches' });
			}
		},
	);

	// Add other vibe routes here if needed in the future (e.g., GET /sessions/:id, PUT /sessions/:id, etc.)
}
