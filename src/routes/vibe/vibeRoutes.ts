import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest as FastifyRequestBase, RouteShorthandOptions } from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendNotFound } from '#fastify/responses';
import { currentUser } from '#user/userService/userContext';
import type { VibeService } from '#vibe/vibeService'; // Corrected import path
import type {
	CommitChangesData,
	CreateVibeSessionData,
	FileSystemNode,
	UpdateCodeReviewData,
	UpdateDesignInstructionsData,
	UpdateVibeSessionData,
	VibeSession,
} from '#vibe/vibeTypes';

const ErrorResponseSchema = Type.Object({
	error: Type.String(),
});

const ParamsSchema = Type.Object({
	sessionId: Type.String({ description: 'The ID of the Vibe session' }),
});
type ParamsType = Static<typeof ParamsSchema>;

// Response Schema for a single Vibe Session
const VibeSessionResponseSchema = Type.Object({
	id: Type.String(),
	userId: Type.String(),
	title: Type.String(),
	instructions: Type.String(),
	repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
	repositoryId: Type.String(),
	repositoryName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	targetBranch: Type.String(), // Renamed from branch
	// newBranchName removed
	workingBranch: Type.String(), // Added
	createWorkingBranch: Type.Boolean(), // Added
	useSharedRepos: Type.Boolean(),
	status: Type.Union([
		Type.Literal('initializing'),
		Type.Literal('design_review'),
		Type.Literal('coding'),
		Type.Literal('code_review'),
		Type.Literal('committing'),
		Type.Literal('monitoring_ci'),
		Type.Literal('ci_failed'),
		Type.Literal('completed'),
		Type.Literal('error'),
	]),
	lastAgentActivity: Type.Optional(Type.Any({ description: 'Timestamp of last agent activity (serialized)' })), // Using Any for FieldValue | Date flexibility
	fileSelection: Type.Optional(Type.Any({ description: 'Array of selected files (structure depends on SelectedFile)' })), // Define more strictly if possible based on SelectedFile structure
	designAnswer: Type.Optional(Type.String()),
	codeDiff: Type.Optional(Type.String()),
	commitSha: Type.Optional(Type.String()),
	pullRequestUrl: Type.Optional(Type.String()),
	ciCdStatus: Type.Optional(
		Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('success'), Type.Literal('failed'), Type.Literal('cancelled')]),
	),
	ciCdJobUrl: Type.Optional(Type.String()),
	ciCdAnalysis: Type.Optional(Type.String()),
	ciCdProposedFix: Type.Optional(Type.String()),
	createdAt: Type.Any({ description: 'Timestamp of creation (serialized)' }), // Using Any for FieldValue | Date flexibility
	updatedAt: Type.Any({ description: 'Timestamp of last update (serialized)' }), // Using Any for FieldValue | Date flexibility
	error: Type.Optional(Type.String()),
});
type VibeSessionResponseType = Static<typeof VibeSessionResponseSchema>;

const VibeSessionListResponseSchema = Type.Array(
	Type.Pick(VibeSessionResponseSchema, ['id', 'title', 'status', 'createdAt', 'updatedAt', 'repositoryName', 'targetBranch']), // Updated branch to targetBranch
);

const CreateVibeSessionBodySchema = Type.Object({
	title: Type.String(),
	instructions: Type.String(),
	repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
	repositoryId: Type.String(),
	repositoryName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	targetBranch: Type.String({ description: 'The existing branch to base the work on and merge into' }), // Renamed from branch
	// newBranchName removed
	workingBranch: Type.String({ description: 'The name of the branch to perform work on (can be new or existing)' }), // Added
	createWorkingBranch: Type.Boolean({ description: 'Whether the workingBranch needs to be created' }), // Added
	useSharedRepos: Type.Boolean(),
});
type CreateVibeSessionBodyType = Static<typeof CreateVibeSessionBodySchema>;

// PATCH /:sessionId (Update Session)
const UpdateVibeSessionBodySchema = Type.Partial(
	Type.Object({
		// Fields likely updatable via a generic PATCH
		title: Type.String(),
		instructions: Type.String(),
		status: Type.Union([
			// Reflects possible target statuses, adjust if needed
			Type.Literal('initializing'),
			Type.Literal('design_review'),
			Type.Literal('coding'),
			Type.Literal('code_review'),
			Type.Literal('committing'),
			Type.Literal('monitoring_ci'),
			Type.Literal('ci_failed'),
			Type.Literal('completed'),
			Type.Literal('error'),
		]),
		fileSelection: Type.Any({ description: 'Array of selected files' }), // Keep as Any for flexibility unless specific structure is enforced
		designAnswer: Type.String(),
		codeDiff: Type.String(), // Added based on UpdateVibeSessionData possibility
		commitSha: Type.String(), // Added based on UpdateVibeSessionData possibility
		pullRequestUrl: Type.String(), // Added based on UpdateVibeSessionData possibility
		ciCdStatus: Type.Union([
			// Added based on UpdateVibeSessionData possibility
			Type.Literal('pending'),
			Type.Literal('running'),
			Type.Literal('success'),
			Type.Literal('failed'),
			Type.Literal('cancelled'),
		]),
		ciCdJobUrl: Type.String(), // Added based on UpdateVibeSessionData possibility
		ciCdAnalysis: Type.String(), // Added based on UpdateVibeSessionData possibility
		ciCdProposedFix: Type.String(), // Added based on UpdateVibeSessionData possibility
		error: Type.String(), // For setting/clearing error messages
		// Note: Other fields like repositoryName, newBranchName, useSharedRepos could be added
		// if direct PATCH updates are intended for them. Timestamps are usually system-managed.
	}),
	{ additionalProperties: false }, // Prevent unexpected fields
);
type UpdateVibeSessionBodyType = Static<typeof UpdateVibeSessionBodySchema>;

// POST /:sessionId/update-design
const UpdateDesignBodySchema = Type.Object({
	instructions: Type.String(),
});
type UpdateDesignBodyType = Static<typeof UpdateDesignBodySchema>;

// POST /:sessionId/update-code
const UpdateCodeBodySchema = Type.Object({
	reviewComments: Type.String(),
});
type UpdateCodeBodyType = Static<typeof UpdateCodeBodySchema>;

// POST /:sessionId/commit
const CommitBodySchema = Type.Object({
	commitTitle: Type.String(),
	commitMessage: Type.String(),
});
type CommitBodyType = Static<typeof CommitBodySchema>;

const CommitResponseSchema = Type.Object({
	commitSha: Type.Optional(Type.String()),
	prUrl: Type.Optional(Type.String()),
});

// GET /repositories/branches
const GetBranchesQuerySchema = Type.Object({
	source: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')], {
		description: 'The source control management system type',
	}),
	id: Type.String({ description: 'The repository identifier (e.g., path for local, project ID/path for remote)' }),
});
type GetBranchesQueryType = Static<typeof GetBranchesQuerySchema>;

const GetBranchesResponseSchema = Type.Array(Type.String());

// GET /:sessionId/tree
const GetTreeQuerySchema = Type.Object({
	path: Type.Optional(Type.String({ description: 'Optional subdirectory path to get the tree for' })),
});
type GetTreeQueryType = Static<typeof GetTreeQuerySchema>;

// Recursive helper for FileSystemNode schema
const FileSystemNodeSchema = Type.Recursive((Self) =>
	Type.Object({
		name: Type.String(),
		type: Type.Union([Type.Literal('file'), Type.Literal('directory')]),
		children: Type.Optional(Type.Array(Self)),
	}),
);
// The service returns an array of nodes (potentially representing the root level)
const GetTreeResponseSchema = Type.Array(FileSystemNodeSchema);

// GET /:sessionId/file
const GetFileQuerySchema = Type.Object({
	path: Type.String({ description: 'The full path to the file within the repository' }),
});
type GetFileQueryType = Static<typeof GetFileQuerySchema>;

const GetFileResponseSchema = Type.Object({
	content: Type.String(),
});

// --- Base Path ---
const basePath = '/api/vibe';

// --- Route Definitions ---
export async function vibeRoutes(fastify: AppFastifyInstance) {
	const vibeService = fastify.vibeService; // Access service from app context

	// --- CRUD Operations ---

	// Create a new Vibe session
	fastify.post<{ Body: CreateVibeSessionBodyType; Reply: VibeSessionResponseType | Static<typeof ErrorResponseSchema> }>(
		basePath,
		{
			schema: {
				body: CreateVibeSessionBodySchema,
				response: {
					201: VibeSessionResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			try {
				// Map request body to CreateVibeSessionData using the new fields
				const createData: CreateVibeSessionData = {
					// Spread the body which now matches CreateVibeSessionData fields
					...request.body,
					// Handle optional fields explicitly if needed (though spread should work)
					repositoryName: request.body.repositoryName ?? undefined,
					// newBranchName mapping removed as it's no longer in the schema/type
				};
				const newSession = await vibeService.createVibeSession(userId, createData);
				// The newSession (type VibeSession) now matches the updated VibeSessionResponseSchema
				return reply.code(201).send(newSession);
			} catch (error: any) {
				fastify.log.error(error, `Error creating Vibe session for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to create Vibe session' });
			}
		},
	);

	// List Vibe sessions for the current user
	fastify.get<{ Reply: Static<typeof VibeSessionListResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		basePath,
		{
			schema: {
				response: {
					200: VibeSessionListResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			try {
				const sessions = await vibeService.listVibeSessions(userId);
				// Ensure timestamps are serializable if needed before sending
				return reply.send(sessions);
			} catch (error: any) {
				fastify.log.error(error, `Error listing Vibe sessions for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to list Vibe sessions' });
			}
		},
	);

	// Get a specific Vibe session by ID
	fastify.get<{ Params: ParamsType; Reply: VibeSessionResponseType | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId`,
		{
			schema: {
				params: ParamsSchema,
				response: {
					200: VibeSessionResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			try {
				const session = await vibeService.getVibeSession(userId, sessionId);
				if (!session) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found`);
				}
				// Ensure timestamps are serializable if needed
				return reply.send(session);
			} catch (error: any) {
				fastify.log.error(error, `Error getting Vibe session ${sessionId} for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to retrieve Vibe session' });
			}
		},
	);

	// Update a Vibe session (partial updates allowed)
	fastify.patch<{ Params: ParamsType; Body: UpdateVibeSessionBodyType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/:sessionId`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateVibeSessionBodySchema,
				response: {
					204: Type.Null({ description: 'Update successful' }),
					400: ErrorResponseSchema, // For invalid body data
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			const updates = request.body;

			if (Object.keys(updates).length === 0) {
				return reply.code(400).send({ error: 'Update payload cannot be empty' });
			}

			try {
				// VibeService should handle checking ownership and existence
				await vibeService.updateVibeSession(userId, sessionId, updates as UpdateVibeSessionData); // Cast needed if schema doesn't perfectly match type
				return reply.code(204).send();
			} catch (error: any) {
				// Handle specific errors like 'not found' if the service throws them
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found for update`);
				}
				fastify.log.error(error, `Error updating Vibe session ${sessionId} for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to update Vibe session' });
			}
		},
	);

	// Delete a Vibe session
	fastify.delete<{ Params: ParamsType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/:sessionId`,
		{
			schema: {
				params: ParamsSchema,
				response: {
					204: Type.Null({ description: 'Delete successful' }),
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			try {
				// VibeService should handle checking ownership and existence
				await vibeService.deleteVibeSession(userId, sessionId);
				return reply.code(204).send();
			} catch (error: any) {
				// Handle specific errors like 'not found'
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found for deletion`);
				}
				fastify.log.error(error, `Error deleting Vibe session ${sessionId} for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to delete Vibe session' });
			}
		},
	);

	// --- Workflow Actions ---

	// Update the design based on new instructions (triggers design agent)
	fastify.post<{ Params: ParamsType; Body: UpdateDesignBodyType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/:sessionId/update-design`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateDesignBodySchema,
				response: {
					202: Type.Null({ description: 'Design update accepted and processing started' }),
					400: ErrorResponseSchema, // Invalid input
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // Session not found
					409: ErrorResponseSchema, // Conflict (e.g., session in wrong state)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			const data: UpdateDesignInstructionsData = request.body;
			try {
				await vibeService.updateDesignWithInstructions(userId, sessionId, data);
				return reply.code(202).send();
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design update for session ${sessionId}, user ${userId}`);
				// Add specific status codes based on error type (e.g., 409 for wrong state)
				return reply.code(500).send({ error: error.message || 'Failed to trigger design update' });
			}
		},
	);

	// Start the coding phase based on the current design (triggers coding agent)
	fastify.post<{ Params: ParamsType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/:sessionId/start-coding`,
		{
			schema: {
				params: ParamsSchema,
				response: {
					202: Type.Null({ description: 'Coding phase start accepted and processing started' }),
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // Session not found
					409: ErrorResponseSchema, // Conflict (e.g., session in wrong state, no design)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			try {
				await vibeService.startCoding(userId, sessionId);
				return reply.code(202).send();
			} catch (error: any) {
				fastify.log.error(error, `Error triggering start coding for session ${sessionId}, user ${userId}`);
				// Add specific status codes based on error type (e.g., 409 for wrong state)
				return reply.code(500).send({ error: error.message || 'Failed to trigger start coding' });
			}
		},
	);

	// Update the code based on review comments (triggers coding agent)
	fastify.post<{ Params: ParamsType; Body: UpdateCodeBodyType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/:sessionId/update-code`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateCodeBodySchema,
				response: {
					202: Type.Null({ description: 'Code update accepted and processing started' }),
					400: ErrorResponseSchema, // Invalid input
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // Session not found
					409: ErrorResponseSchema, // Conflict (e.g., session in wrong state)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			const data: UpdateCodeReviewData = request.body;
			try {
				await vibeService.updateCodeWithComments(userId, sessionId, data);
				return reply.code(202).send();
			} catch (error: any) {
				fastify.log.error(error, `Error triggering code update for session ${sessionId}, user ${userId}`);
				// Add specific status codes based on error type (e.g., 409 for wrong state)
				return reply.code(500).send({ error: error.message || 'Failed to trigger code update' });
			}
		},
	);

	// Commit the generated code changes to the repository
	fastify.post<{ Params: ParamsType; Body: CommitBodyType; Reply: Static<typeof CommitResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/commit`,
		{
			schema: {
				params: ParamsSchema,
				body: CommitBodySchema,
				response: {
					200: CommitResponseSchema, // Success, returns commit info
					400: ErrorResponseSchema, // Invalid input
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // Session not found
					409: ErrorResponseSchema, // Conflict (e.g., session in wrong state, no code changes)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			const data: CommitChangesData = request.body;
			try {
				const result = await vibeService.commitChanges(userId, sessionId, data);
				return reply.code(200).send(result); // Assuming synchronous commit for now
			} catch (error: any) {
				fastify.log.error(error, `Error committing changes for session ${sessionId}, user ${userId}`);
				// Add specific status codes based on error type (e.g., 409 for wrong state)
				return reply.code(500).send({ error: error.message || 'Failed to commit changes' });
			}
		},
	);

	// Apply the AI-proposed fix for a CI/CD failure
	fastify.post<{ Params: ParamsType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/:sessionId/apply-cicd-fix`,
		{
			schema: {
				params: ParamsSchema,
				response: {
					202: Type.Null({ description: 'CI/CD fix application accepted and processing started' }),
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // Session not found
					409: ErrorResponseSchema, // Conflict (e.g., not in ci_failed state, no fix available)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			try {
				// VibeService should check ownership, existence, and state validity
				await vibeService.applyCiCdFix(userId, sessionId);
				return reply.code(202).send();
			} catch (error: any) {
				fastify.log.error(error, `Error applying CI/CD fix for session ${sessionId}, user ${userId}`);
				// Consider specific error mapping for 404, 409 based on service exceptions
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found`);
				}
				if (error.message?.includes('state') || error.message?.includes('fix')) {
					// Basic check for state/logic errors, service should provide clearer messages
					return reply.code(409).send({ error: error.message || 'Cannot apply CI/CD fix in current state or no fix available' });
				}
				return reply.code(500).send({ error: error.message || 'Failed to apply CI/CD fix' });
			}
		},
	);

	// --- Helper Methods ---

	// Get a list of branches for a given repository
	fastify.get<{ Querystring: GetBranchesQueryType; Reply: Static<typeof GetBranchesResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/repositories/branches`,
		{
			schema: {
				querystring: GetBranchesQuerySchema,
				response: {
					200: GetBranchesResponseSchema,
					400: ErrorResponseSchema, // Invalid query params
					401: ErrorResponseSchema,
					404: ErrorResponseSchema, // Repository not found/accessible
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id; // Assuming userId might be needed for access control
			const { source, id } = request.query;
			try {
				const branches = await vibeService.getBranchList(userId, source, id);
				return reply.send(branches);
			} catch (error: any) {
				fastify.log.error(error, `Error getting branches for repo ${id} (source: ${source}), user ${userId}`);
				// Add specific status codes (e.g., 404 if repo not found)
				return reply.code(500).send({ error: error.message || 'Failed to get branch list' });
			}
		},
	);

	// Get the file system tree structure for a Vibe session repository
	fastify.get<{ Params: ParamsType; Querystring: GetTreeQueryType; Reply: Static<typeof GetTreeResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/tree`,
		{
			schema: {
				params: ParamsSchema,
				querystring: GetTreeQuerySchema,
				response: {
					200: GetTreeResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema, // Session or path not found
					409: ErrorResponseSchema, // Session not initialized/ready
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			const { path } = request.query; // path is optional
			try {
				const tree = await vibeService.getFileSystemTree(userId, sessionId, path);
				return reply.send(tree);
			} catch (error: any) {
				fastify.log.error(error, `Error getting file system tree for session ${sessionId} (path: ${path}), user ${userId}`);
				// Add specific status codes (e.g., 404, 409)
				return reply.code(500).send({ error: error.message || 'Failed to get file system tree' });
			}
		},
	);

	// Get the content of a specific file within a Vibe session repository
	fastify.get<{ Params: ParamsType; Querystring: GetFileQueryType; Reply: Static<typeof GetFileResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/file`,
		{
			schema: {
				params: ParamsSchema,
				querystring: GetFileQuerySchema,
				response: {
					200: GetFileResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema, // Session or file not found
					409: ErrorResponseSchema, // Session not initialized/ready
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params;
			const { path: filePath } = request.query; // path is required
			try {
				const content = await vibeService.getFileContent(userId, sessionId, filePath);
				return reply.send({ content });
			} catch (error: any) {
				fastify.log.error(error, `Error getting file content for session ${sessionId} (path: ${filePath}), user ${userId}`);
				// Add specific status codes (e.g., 404, 409)
				return reply.code(500).send({ error: error.message || 'Failed to get file content' });
			}
		},
	);
}
