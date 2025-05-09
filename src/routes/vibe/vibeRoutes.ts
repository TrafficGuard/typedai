import { type Static, Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyRequest as FastifyRequestBase, RouteShorthandOptions } from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendJSON, sendNotFound } from '#fastify/responses';
import { FileSystemNode } from '#functions/storage/fileSystemService';
import { currentUser } from '#user/userService/userContext';
import type { VibeService } from '#vibe/vibeService';
import { VibeServiceImpl } from '#vibe/vibeServiceImpl';
import type {
	CommitChangesData,
	CreateVibeSessionData,
	GenerateDesignData,
	UpdateCodeReviewData,
	UpdateDesignPromptData,
	UpdateSelectionPromptData,
	UpdateVibeSessionData,
	VibePreset,
	VibePresetConfig,
	VibeSession,
} from '#vibe/vibeTypes';

const ErrorResponseSchema = Type.Object({
	error: Type.String(),
});

const ParamsSchema = Type.Object({
	sessionId: Type.String({ description: 'The ID of the Vibe session' }),
});
type ParamsType = Static<typeof ParamsSchema>;

// Schema for the DesignAnswer object
const DesignAnswerSchema = Type.Object({
	summary: Type.String(),
	steps: Type.Array(Type.String()),
	reasoning: Type.String(),
	variations: Type.Optional(Type.Number()),
});

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
		Type.Literal('file_selection_review'),
		Type.Literal('updating_file_selection'),
		Type.Literal('generating_design'),
		Type.Literal('design_review'),
		Type.Literal('design_review_feedback'),
		Type.Literal('design_review_details'),
		Type.Literal('updating_design'),
		Type.Literal('coding'),
		Type.Literal('code_review'),
		Type.Literal('committing'),
		Type.Literal('monitoring_ci'),
		Type.Literal('ci_failed'),
		Type.Literal('completed'),
		Type.Literal('error_file_selection'),
		Type.Literal('error_design_generation'),
		Type.Literal('error_coding'),
		Type.Literal('error'),
	]),
	lastAgentActivity: Type.Optional(Type.Any({ description: 'Timestamp of last agent activity (serialized)' })), // Using Any for FieldValue | Date flexibility
	fileSelection: Type.Optional(Type.Any({ description: 'Array of selected files (structure depends on SelectedFile)' })), // Define more strictly if possible based on SelectedFile structure
	designAnswer: Type.Optional(DesignAnswerSchema), // Use the defined object schema
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
	// Added VibePresetConfig schema (assuming it's an object, adjust if needed)
	config: Type.Optional(Type.Record(Type.String(), Type.Any())),
});
type VibeSessionResponseType = Static<typeof VibeSessionResponseSchema>;

// --- Preset Schemas ---

// Define the config schema based on VibePresetConfig (Omit<CreateVibeSessionData, 'title' | 'instructions'>)
const VibePresetConfigSchema = Type.Object(
	{
		repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
		repositoryId: Type.String(),
		repositoryName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		targetBranch: Type.String(),
		workingBranch: Type.String(),
		createWorkingBranch: Type.Boolean(),
		useSharedRepos: Type.Boolean(),
		// Add any other fields from CreateVibeSessionData except title/instructions if they exist
	},
	{ description: 'Configuration object for the preset', additionalProperties: false },
); // Prevent extra properties

const VibePresetSchema = Type.Object({
	id: Type.String(),
	userId: Type.String(),
	name: Type.String(),
	config: VibePresetConfigSchema,
	createdAt: Type.Number({ description: 'Timestamp of creation' }),
	updatedAt: Type.Number({ description: 'Timestamp of last update' }),
});
type VibePresetType = Static<typeof VibePresetSchema>;

const CreatePresetBodySchema = Type.Object({
	name: Type.String({ description: 'Name of the preset' }),
	config: VibePresetConfigSchema,
});
type CreatePresetBodyType = Static<typeof CreatePresetBodySchema>;

const PresetListResponseSchema = Type.Array(VibePresetSchema);

const PresetParamsSchema = Type.Object({
	presetId: Type.String({ description: 'The ID of the Vibe preset' }),
});
type PresetParamsType = Static<typeof PresetParamsSchema>;

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
			// Reflects all possible statuses from VibeSession
			Type.Literal('initializing'),
			Type.Literal('file_selection_review'),
			Type.Literal('updating_file_selection'),
			Type.Literal('generating_design'),
			Type.Literal('design_review'),
			Type.Literal('design_review_feedback'),
			Type.Literal('design_review_details'),
			Type.Literal('updating_design'),
			Type.Literal('coding'),
			Type.Literal('code_review'),
			Type.Literal('committing'),
			Type.Literal('monitoring_ci'),
			Type.Literal('ci_failed'),
			Type.Literal('completed'),
			Type.Literal('error_file_selection'),
			Type.Literal('error_design_generation'),
			Type.Literal('error_coding'),
			Type.Literal('error'),
		]),
		fileSelection: Type.Any({ description: 'Array of selected files' }), // Keep as Any for flexibility unless specific structure is enforced
		designAnswer: DesignAnswerSchema, // Use the defined object schema
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
	design: Type.String(),
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

// --- Workflow Action Schemas ---

// POST /:sessionId/update-selection
const UpdateSelectionBodySchema = Type.Object({
	prompt: Type.String({ description: 'User prompt to guide file selection refinement' }),
});
type UpdateSelectionBodyType = Static<typeof UpdateSelectionBodySchema>;

// POST /:sessionId/generate-design
const GenerateDesignBodySchema = Type.Object({
	variations: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 5,
			description: 'Number of design variations to generate (1-5)',
		}),
	),
});
type GenerateDesignBodyType = Static<typeof GenerateDesignBodySchema>;

// POST /:sessionId/update-design-instructions
const UpdateDesignPromptBodySchema = Type.Object({
	prompt: Type.String({ description: 'User prompt to guide design refinement' }),
});
type UpdateDesignPromptBodyType = Static<typeof UpdateDesignPromptBodySchema>;

// Generic Accepted Response
const AcceptedResponseSchema = Type.Object({
	message: Type.String(),
});

// GET /repositories/branches
const GetBranchesQuerySchema = Type.Object({
	source: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')], {
		description: 'The source control management system type',
	}),
	id: Type.String({ description: 'The repository identifier (e.g., path for local, project ID/path for remote)' }),
	sessionId: Type.String({ description: 'VibeSession id' }),
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
	const vibeService = new VibeServiceImpl(fastify.vibeRepository);

	// --- Vibe Session CRUD Operations ---

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
				return sendJSON(reply, session);
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
				// Cast 'updates' to 'any' first, then to 'UpdateVibeSessionData' to bypass stricter TS checks
				// This is necessary because TypeBox schema (designAnswer: string) doesn't perfectly match the service type (designAnswer: DesignAnswer)
				// The underlying service logic should handle the data correctly.
				await vibeService.updateVibeSession(userId, sessionId, updates as any as UpdateVibeSessionData);
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

	// --- Vibe Preset Operations ---

	// Create a new Vibe preset
	fastify.post<{ Body: CreatePresetBodyType; Reply: VibePresetType | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/presets`,
		{
			schema: {
				body: CreatePresetBodySchema,
				response: {
					201: VibePresetSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { name, config } = request.body;
			if (!name || !config) {
				return reply.code(400).send({ error: 'Missing required fields: name and config' });
			}
			try {
				// Cast the request body config to the specific VibePresetConfig type expected by the service
				const presetConfig = config as VibePresetConfig;
				const newPreset = await vibeService.saveVibePreset(userId, name, presetConfig);
				// The returned newPreset (type VibePreset) now includes createdAt/updatedAt, matching VibePresetSchema
				return reply.code(201).send(newPreset);
			} catch (error: any) {
				fastify.log.error(error, `Error creating Vibe preset for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to create Vibe preset' });
			}
		},
	);

	// List Vibe presets for the current user
	fastify.get<{ Reply: Static<typeof PresetListResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/presets`,
		{
			schema: {
				response: {
					200: PresetListResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			try {
				const presets = await vibeService.listVibePresets(userId);
				// The returned presets (type VibePreset[]) now include createdAt/updatedAt, matching PresetListResponseSchema
				return reply.send(presets);
			} catch (error: any) {
				fastify.log.error(error, `Error listing Vibe presets for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to list Vibe presets' });
			}
		},
	);

	// Delete a Vibe preset
	fastify.delete<{ Params: PresetParamsType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/presets/:presetId`,
		{
			schema: {
				params: PresetParamsSchema,
				response: {
					204: Type.Null({ description: 'Delete successful' }),
					400: ErrorResponseSchema, // Invalid presetId format (though unlikely with string)
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { presetId } = request.params;
			if (!presetId) {
				return reply.code(400).send({ error: 'Preset ID is required' });
			}
			try {
				await vibeService.deleteVibePreset(userId, presetId);
				return reply.code(204).send();
			} catch (error: any) {
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe preset with ID ${presetId} not found for deletion`);
				}
				fastify.log.error(error, `Error deleting Vibe preset ${presetId} for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to delete Vibe preset' });
			}
		},
	);

	// --- Vibe Workflow Actions ---

	// Update file selection based on user prompt
	fastify.post<{ Params: ParamsType; Body: UpdateSelectionBodyType; Reply: Static<typeof AcceptedResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/update-selection`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateSelectionBodySchema,
				response: {
					202: AcceptedResponseSchema,
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
			const { prompt } = request.body;
			if (!prompt) {
				return reply.code(400).send({ error: 'Prompt is required' });
			}
			// Pass the prompt string directly
			try {
				await vibeService.updateSelectionWithPrompt(userId, sessionId, prompt);
				return reply.code(202).send({ message: 'File selection update accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering file selection update for session ${sessionId}, user ${userId}`);
				// Add specific status codes based on error type (e.g., 409 for wrong state)
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found`);
				}
				if (error.message?.includes('state')) {
					return reply.code(409).send({ error: error.message || 'Cannot update selection in current state' });
				}
				return reply.code(500).send({ error: error.message || 'Failed to trigger file selection update' });
			}
		},
	);

	// Generate detailed design (potentially with variations)
	fastify.post<{ Params: ParamsType; Body: GenerateDesignBodyType; Reply: Static<typeof AcceptedResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/generate-design`,
		{
			schema: {
				params: ParamsSchema,
				body: GenerateDesignBodySchema, // variations is optional
				response: {
					202: AcceptedResponseSchema,
					400: ErrorResponseSchema, // Invalid input (e.g., variations out of range)
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
			// variations is optional, default handled by service if needed
			const variations = request.body.variations; // Extract variations
			try {
				// Pass variations number directly (or undefined)
				await vibeService.generateDetailedDesign(userId, sessionId, variations);
				return reply.code(202).send({ message: 'Design generation accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design generation for session ${sessionId}, user ${userId}`);
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found`);
				}
				if (error.message?.includes('state')) {
					return reply.code(409).send({ error: error.message || 'Cannot generate design in current state' });
				}
				return reply.code(500).send({ error: error.message || 'Failed to trigger design generation' });
			}
		},
	);

	/** Update a design from a manual edit by the user */
	fastify.post<{ Params: ParamsType; Body: UpdateDesignBodyType; Reply: Static<typeof AcceptedResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/update-design`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateDesignPromptBodySchema,
				response: {
					202: AcceptedResponseSchema,
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
			const { design } = request.body;
			if (!prompt) {
				return reply.code(400).send({ error: 'Prompt is required' });
			}
			// Pass the prompt string directly
			try {
				// Assuming vibeService.updateDesignWithPrompt exists
				await vibeService.updateDesign(userId, sessionId, design);
				return reply.code(202).send({ message: 'Design update accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design update via prompt for session ${sessionId}, user ${userId}`);
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found`);
				}
				if (error.message?.includes('state')) {
					return reply.code(409).send({ error: error.message || 'Cannot update design in current state' });
				}
				return reply.code(500).send({ error: error.message || 'Failed to trigger design update' });
			}
		},
	);

	// Update the design based on user instructions
	fastify.post<{ Params: ParamsType; Body: UpdateDesignPromptBodyType; Reply: Static<typeof AcceptedResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/update-design-prompt`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateDesignPromptBodySchema,
				response: {
					202: AcceptedResponseSchema,
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
			const { prompt } = request.body;
			if (!prompt) {
				return reply.code(400).send({ error: 'Prompt is required' });
			}
			try {
				await vibeService.updateDesignFromInstructions(userId, sessionId, prompt);
				return reply.code(202).send({ message: 'Design update accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design update via prompt for session ${sessionId}, user ${userId}`);
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found`);
				}
				if (error.message?.includes('state')) {
					return reply.code(409).send({ error: error.message || 'Cannot update design in current state' });
				}
				return reply.code(500).send({ error: error.message || 'Failed to trigger design update' });
			}
		},
	);

	// Execute the current design (start coding) - replaces previous start-coding
	fastify.post<{ Params: ParamsType; Reply: Static<typeof AcceptedResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/execute-design`,
		{
			schema: {
				params: ParamsSchema,
				response: {
					202: AcceptedResponseSchema,
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
				// Assuming vibeService.executeDesign exists
				await vibeService.executeDesign(userId, sessionId);
				return reply.code(202).send({ message: 'Design execution accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design execution for session ${sessionId}, user ${userId}`);
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Vibe session with ID ${sessionId} not found`);
				}
				if (error.message?.includes('state') || error.message?.includes('design')) {
					return reply.code(409).send({ error: error.message || 'Cannot execute design in current state or no design available' });
				}
				return reply.code(500).send({ error: error.message || 'Failed to trigger design execution' });
			}
		},
	);

	// Reset file selection to its original state for the current review cycle
	fastify.post<{ Params: ParamsType; Reply: Static<typeof AcceptedResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:sessionId/reset-selection`,
		{
			schema: {
				params: ParamsSchema, // Use existing schema for sessionId
				// No body schema is defined as this POST action does not expect a payload
				response: {
					202: AcceptedResponseSchema, // For successful acceptance of the request
					401: ErrorResponseSchema, // Standard error for unauthorized
					404: ErrorResponseSchema, // For session not found
					409: ErrorResponseSchema, // For invalid state (e.g., session not in 'file_selection_review' status)
					500: ErrorResponseSchema, // For other internal server errors
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { sessionId } = request.params; // Params are correctly typed due to <Params: ParamsType>

			try {
				// Assume vibeService.resetFileSelection exists and handles the logic
				// This method is expected to be part of the VibeService interface and implementation
				await vibeService.resetFileSelection(userId, sessionId);

				// Successfully queued/processed the reset request
				return reply.code(202).send({ message: 'File selection reset accepted and processing.' });
			} catch (error: any) {
				// Log the error with context
				fastify.log.error(error, `Error resetting file selection for session ${sessionId}, user ${userId}`);

				const errorMessage = error.message || 'An unexpected error occurred while resetting file selection.';

				// Specific error handling based on message content
				if (errorMessage.toLowerCase().includes('not found')) {
					return sendNotFound(reply, errorMessage); // Use existing helper for 404
				}
				if (errorMessage.toLowerCase().includes('state') || errorMessage.toLowerCase().includes('status')) {
					// This handles cases where the session is not in a state where file selection can be reset
					return reply.code(409).send({ error: errorMessage });
				}
				// Generic fallback for other errors
				return reply.code(500).send({ error: errorMessage });
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
			const { source, id, sessionId } = request.query;
			try {
				const branches = await vibeService.getBranchList(userId, sessionId, source, id);
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
				return sendJSON(reply, tree);
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
