import { type Static, Type } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendNotFound } from '#fastify/responses';
import type { CodeTaskPresetConfig, CommitChangesData, CreateCodeTaskData, UpdateCodeReviewData, UpdateCodeTaskData } from '#shared/codeTask/codeTask.model';
import { CodeTaskStatusApiSchema } from '#shared/codeTask/codeTask.schema';
import { currentUser } from '#user/userContext';

const ErrorResponseSchema = Type.Object({
	error: Type.String(),
});

const ParamsSchema = Type.Object({
	codeTaskId: Type.String({ description: 'The ID of the Code task' }),
});
type ParamsType = Static<typeof ParamsSchema>;

// Response Schema for a single Code Task
const CodeTaskResponseSchema = Type.Object({
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
	status: CodeTaskStatusApiSchema,
	lastAgentActivity: Type.Optional(Type.Any({ description: 'Timestamp of last agent activity (serialized)' })), // Using Any for FieldValue | Date flexibility
	fileSelection: Type.Optional(Type.Any({ description: 'Array of selected files (structure depends on SelectedFile)' })), // Define more strictly if possible based on SelectedFile structure
	designAnswer: Type.Optional(Type.String()), // Use the defined object schema
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
	// Added CodeTaskPresetConfig schema (assuming it's an object, adjust if needed)
	config: Type.Optional(Type.Record(Type.String(), Type.Any())),
});
type CodeTaskResponseType = Static<typeof CodeTaskResponseSchema>;

// --- Preset Schemas ---

// Define the config schema based on CodeTaskPresetConfig (Omit<CreateCodeTaskData, 'title' | 'instructions'>)
const CodeTaskPresetConfigSchema = Type.Object(
	{
		repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
		repositoryId: Type.Optional(Type.String()), // Made optional to match CodeTaskPresetConfig type
		repositoryName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		targetBranch: Type.String(),
		workingBranch: Type.String(),
		createWorkingBranch: Type.Boolean(),
		useSharedRepos: Type.Boolean(),
		// Add any other fields from CreateCodeTaskData except title/instructions if they exist
	},
	{ description: 'Configuration object for the preset', additionalProperties: false },
); // Prevent extra properties

const CodeTaskPresetSchema = Type.Object({
	id: Type.String(),
	userId: Type.String(),
	name: Type.String(),
	config: CodeTaskPresetConfigSchema,
	createdAt: Type.Number({ description: 'Timestamp of creation' }),
	updatedAt: Type.Number({ description: 'Timestamp of last update' }),
});
type CodeTaskPresetType = Static<typeof CodeTaskPresetSchema>;

const CreatePresetBodySchema = Type.Object({
	name: Type.String({ description: 'Name of the preset' }),
	config: CodeTaskPresetConfigSchema,
});
type CreatePresetBodyType = Static<typeof CreatePresetBodySchema>;

const PresetListResponseSchema = Type.Array(CodeTaskPresetSchema);

const PresetParamsSchema = Type.Object({
	presetId: Type.String({ description: 'The ID of the Code task preset' }),
});
type PresetParamsType = Static<typeof PresetParamsSchema>;

const CodeTaskListResponseSchema = Type.Array(
	Type.Pick(CodeTaskResponseSchema, ['id', 'title', 'status', 'createdAt', 'updatedAt', 'repositoryName', 'targetBranch']), // Updated branch to targetBranch
);

const CreateCodeTaskBodySchema = Type.Object({
	title: Type.String(),
	instructions: Type.String(),
	repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
	repositoryId: Type.Optional(Type.String()),
	repositoryName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	targetBranch: Type.String({ description: 'The existing branch to base the work on and merge into' }), // Renamed from branch
	// newBranchName removed
	workingBranch: Type.String({ description: 'The name of the branch to perform work on (can be new or existing)' }), // Added
	createWorkingBranch: Type.Boolean({ description: 'Whether the workingBranch needs to be created' }), // Added
	useSharedRepos: Type.Boolean(),
});
type CreateCodeTaskBodyType = Static<typeof CreateCodeTaskBodySchema>;

// PATCH /:codeTaskId (Update CodeTask)
const UpdateCodeTaskBodySchema = Type.Partial(
	Type.Object({
		// Fields likely updatable via a generic PATCH
		title: Type.String(),
		instructions: Type.String(),
		status: Type.Union([
			// Reflects all possible statuses from CodeTask
			Type.Literal('initializing'),
			Type.Literal('file_selection_review'),
			Type.Literal('updating_file_selection'),
			Type.Literal('generating_design'),
			Type.Literal('design_review'),
			Type.Literal('design_review_details'),
			Type.Literal('updating_design'),
			Type.Literal('coding'),
			Type.Literal('code_review'),
			Type.Literal('generating_code_review_feedback'),
			Type.Literal('updating_code_review_feedback'),
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
		designAnswer: Type.String(),
		codeDiff: Type.String(),
		commitSha: Type.String(),
		pullRequestUrl: Type.String(),
		ciCdStatus: Type.Union([
			// Added based on UpdateCodeTaskData possibility
			Type.Literal('pending'),
			Type.Literal('running'),
			Type.Literal('success'),
			Type.Literal('failed'),
			Type.Literal('cancelled'),
		]),
		ciCdJobUrl: Type.String(),
		ciCdAnalysis: Type.String(),
		ciCdProposedFix: Type.String(),
		error: Type.String(), // For setting/clearing error messages
		// Note: Other fields like repositoryName, newBranchName, useSharedRepos could be added
		// if direct PATCH updates are intended for them. Timestamps are usually system-managed.
	}),
	{ additionalProperties: false }, // Prevent unexpected fields
);
type UpdateCodeTaskBodyType = Static<typeof UpdateCodeTaskBodySchema>;

// POST /:codeTaskId/update-design
const UpdateDesignBodySchema = Type.Object({
	design: Type.String(),
});
type UpdateDesignBodyType = Static<typeof UpdateDesignBodySchema>;

// POST /:codeTaskId/update-code
const UpdateCodeBodySchema = Type.Object({
	reviewComments: Type.String(),
});
type UpdateCodeBodyType = Static<typeof UpdateCodeBodySchema>;

// POST /:codeTaskId/commit
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

// POST /:codeTaskId/update-selection
const UpdateSelectionBodySchema = Type.Object({
	prompt: Type.String({ description: 'User prompt to guide file selection refinement' }),
});
type UpdateSelectionBodyType = Static<typeof UpdateSelectionBodySchema>;

// POST /:codeTaskId/generate-design
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

// POST /:codeTaskId/update-design-instructions
const UpdateDesignPromptBodySchema = Type.Object({
	prompt: Type.String({ description: 'User prompt to guide design refinement' }),
});
type UpdateDesignPromptBodyType = Static<typeof UpdateDesignPromptBodySchema>;

// Generic Accepted Response
const AcceptedResponseSchema = Type.Object({
	message: Type.String(),
});

// GET /:codeTaskId/branches
// Query schema for fetching branches, aligning with SCM standards
const GetBranchesQuerySchema = Type.Object({
	providerType: Type.String({ description: "The type of SCM provider, e.g., 'local', 'gitlab', or 'github'" }),
	projectId: Type.String({ description: 'The project identifier (repository path for local, project ID/path for remote)' }),
});
type GetBranchesQueryType = Static<typeof GetBranchesQuerySchema>;

const GetBranchesResponseSchema = Type.Array(Type.String());

// GET /:codeTaskId/tree
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
const GetTreeResponseSchema = FileSystemNodeSchema;

// GET /:codeTaskId/file
const GetFileQuerySchema = Type.Object({
	path: Type.String({ description: 'The full path to the file within the repository' }),
});
type GetFileQueryType = Static<typeof GetFileQuerySchema>;

const GetFileResponseSchema = Type.Object({
	content: Type.String(),
});

const basePath = '/api/codeTask';

export async function codeTaskRoutes(fastify: AppFastifyInstance) {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	// --- Code Task CRUD Operations ---

	// Create a new Code task
	fastify.post<{ Body: CreateCodeTaskBodyType; Reply: CodeTaskResponseType | Static<typeof ErrorResponseSchema> }>(
		basePath,
		{
			schema: {
				body: CreateCodeTaskBodySchema,
				response: {
					201: CodeTaskResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			// Destructure request.body for clarity and to access potentially undefined repositoryId
			const {
				title,
				instructions,
				repositorySource,
				repositoryId: originalRepositoryIdFromRequest,
				repositoryName,
				targetBranch,
				workingBranch,
				createWorkingBranch,
				useSharedRepos,
			} = request.body;

			let effectiveRepositoryId = originalRepositoryIdFromRequest;

			if (!effectiveRepositoryId && repositoryName && (repositorySource === 'github' || repositorySource === 'gitlab')) {
				effectiveRepositoryId = repositoryName;
				fastify.log.info(
					`Code task creation: repositoryId was not provided for source '${repositorySource}', derived from repositoryName '${repositoryName}'.`,
				);
			}

			if (!effectiveRepositoryId) {
				return reply.code(400).send({
					error:
						"repositoryId is required. If using GitHub/GitLab and repositoryId is not directly provided, ensure repositoryName is supplied in 'owner/repo' format to be used as a fallback.",
				});
			}

			try {
				const createData: CreateCodeTaskData = {
					title,
					instructions,
					repositorySource,
					repositoryId: effectiveRepositoryId, // Use the resolved ID
					repositoryName: repositoryName ?? undefined,
					targetBranch,
					workingBranch,
					createWorkingBranch,
					useSharedRepos,
				};
				const newCodeTask = await codeTaskService.createCodeTask(userId, createData);
				// The newCodeTask (type CodeTask) now matches the updated CodeTaskResponseSchema
				return reply.code(201).send(newCodeTask);
			} catch (error: any) {
				fastify.log.error(error, `Error creating Code task for user ${userId} [request.body]`);
				return reply.code(500).send({ error: error.message || 'Failed to create Code task' });
			}
		},
	);

	// List Code tasks for the current user
	fastify.get<{ Reply: Static<typeof CodeTaskListResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		basePath,
		{
			schema: {
				response: {
					200: CodeTaskListResponseSchema,
					401: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			try {
				const codeTasks = await codeTaskService.listCodeTasks(userId);
				// Ensure timestamps are serializable if needed before sending
				return reply.sendJSON(codeTasks);
			} catch (error: any) {
				fastify.log.error(error, `Error listing Code tasks for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to list Code tasks' });
			}
		},
	);

	// Get a specific Code task by ID
	fastify.get<{ Params: ParamsType; Reply: CodeTaskResponseType | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:codeTaskId`,
		{
			schema: {
				params: ParamsSchema,
				response: {
					200: CodeTaskResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			try {
				const codeTask = await codeTaskService.getCodeTask(userId, codeTaskId);
				if (!codeTask) {
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
				}
				return reply.sendJSON(codeTask);
			} catch (error: any) {
				fastify.log.error(error, `Error getting Code task ${codeTaskId} for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to retrieve Code task' });
			}
		},
	);

	// Update a Code task (partial updates allowed)
	fastify.patch<{ Params: ParamsType; Body: UpdateCodeTaskBodyType; Reply: CodeTaskResponseType | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:codeTaskId`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateCodeTaskBodySchema,
				response: {
					200: CodeTaskResponseSchema, // Changed from 204
					400: ErrorResponseSchema, // For invalid body data
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const updates = request.body;

			if (Object.keys(updates).length === 0) {
				return reply.code(400).send({ error: 'Update payload cannot be empty' });
			}

			try {
				// CodeTaskService should handle checking ownership and existence
				// Cast 'updates' to 'any' first, then to 'UpdateCodeTaskData' to bypass stricter TS checks
				// This is necessary because TypeBox schema (designAnswer: string) doesn't perfectly match the service type (designAnswer: DesignAnswer)
				// The underlying service logic should handle the data correctly.
				await codeTaskService.updateCodeTask(userId, codeTaskId, updates as any as UpdateCodeTaskData);
				const updatedCodeTask = await codeTaskService.getCodeTask(userId, codeTaskId);
				if (!updatedCodeTask) {
					// This case should ideally not be reached if updateCodeTask didn't throw and ID was valid
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found after update`);
				}
				return reply.sendJSON(updatedCodeTask);
			} catch (error: any) {
				// Handle specific errors like 'not found' if the service throws them
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found for update`);
				}
				fastify.log.error(error, `Error updating Code task ${codeTaskId} for user ${userId} [updates]`);
				return reply.code(500).send({ error: error.message || 'Failed to update Code task' });
			}
		},
	);

	// Delete a Code task
	fastify.delete<{ Params: ParamsType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/:codeTaskId`,
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
			const { codeTaskId } = request.params;
			try {
				// CodeTaskService should handle checking ownership and existence
				await codeTaskService.deleteCodeTask(userId, codeTaskId);
				return reply.code(204).send();
			} catch (error: any) {
				// Handle specific errors like 'not found'
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found for deletion`);
				}
				fastify.log.error(error, `Error deleting Code task ${codeTaskId} for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to delete Code task' });
			}
		},
	);

	// --- CodeTask Preset Operations ---

	// Create a new Code task preset
	fastify.post<{ Body: CreatePresetBodyType; Reply: CodeTaskPresetType | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/presets`,
		{
			schema: {
				body: CreatePresetBodySchema,
				response: {
					201: CodeTaskPresetSchema,
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
				// Cast the request body config to the specific CodeTaskPresetConfig type expected by the service
				const presetConfig = config as CodeTaskPresetConfig;
				const newPreset = await codeTaskService.saveCodeTaskPreset(userId, name, presetConfig);
				// The returned newPreset (type CodeTaskPreset) now includes createdAt/updatedAt, matching CodeTaskPresetSchema
				return reply.code(201).send(newPreset);
			} catch (error: any) {
				fastify.log.error(error, `Error creating Code task preset for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to create Code task preset' });
			}
		},
	);

	// List Code task presets for the current user
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
				const presets = await codeTaskService.listCodeTaskPresets(userId);
				// The returned presets (type CodeTaskPreset[]) now include createdAt/updatedAt, matching PresetListResponseSchema
				return reply.send(presets);
			} catch (error: any) {
				fastify.log.error(error, `Error listing Code task presets for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to list Code task presets' });
			}
		},
	);

	// Delete a Code task preset
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
				await codeTaskService.deleteCodeTaskPreset(userId, presetId);
				return reply.code(204).send();
			} catch (error: any) {
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Code task preset with ID ${presetId} not found for deletion`);
				}
				fastify.log.error(error, `Error deleting Code task preset ${presetId} for user ${userId}`);
				return reply.code(500).send({ error: error.message || 'Failed to delete Code task preset' });
			}
		},
	);

	// --- CodeTask Workflow Actions ---

	// Update file selection based on user prompt
	fastify.post<{ Params: ParamsType; Body: UpdateSelectionBodyType; Reply: Static<typeof AcceptedResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:codeTaskId/update-selection`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateSelectionBodySchema,
				response: {
					202: AcceptedResponseSchema,
					400: ErrorResponseSchema, // Invalid input
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // CodeTask not found
					409: ErrorResponseSchema, // Conflict (e.g., codeTask in wrong state)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const { prompt } = request.body;
			if (!prompt) {
				return reply.code(400).send({ error: 'Prompt is required' });
			}
			// Pass the prompt string directly
			try {
				await codeTaskService.updateSelectionWithPrompt(userId, codeTaskId, prompt);
				return reply.code(202).send({ message: 'File selection update accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering file selection update for codeTask ${codeTaskId}, user ${userId}`);
				// Add specific status codes based on error type (e.g., 409 for wrong state)
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
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
		`${basePath}/:codeTaskId/generate-design`,
		{
			schema: {
				params: ParamsSchema,
				body: GenerateDesignBodySchema, // variations is optional
				response: {
					202: AcceptedResponseSchema,
					400: ErrorResponseSchema, // Invalid input (e.g., variations out of range)
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // CodeTask not found
					409: ErrorResponseSchema, // Conflict (e.g., codeTask in wrong state)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			// variations is optional, default handled by service if needed
			const variations = request.body.variations; // Extract variations
			try {
				// Pass variations number directly (or undefined)
				await codeTaskService.generateDetailedDesign(userId, codeTaskId, variations);
				return reply.code(202).send({ message: 'Design generation accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design generation for codeTask ${codeTaskId}, user ${userId}`);
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
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
		`${basePath}/:codeTaskId/update-design`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateDesignBodySchema,
				response: {
					202: AcceptedResponseSchema,
					400: ErrorResponseSchema, // Invalid input
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // CodeTask not found
					409: ErrorResponseSchema, // Conflict (e.g., codeTask in wrong state)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const { design } = request.body;
			if (!design) {
				return reply.code(400).send({ error: 'Design is required' });
			}
			// Pass the design string directly
			try {
				// Assuming codeTaskService.updateDesign exists
				await codeTaskService.updateDesign(userId, codeTaskId, design);
				return reply.code(202).send({ message: 'Design update accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design update for codeTask ${codeTaskId}, user ${userId}`);
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
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
		`${basePath}/:codeTaskId/update-design-prompt`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateDesignPromptBodySchema,
				response: {
					202: AcceptedResponseSchema,
					400: ErrorResponseSchema, // Invalid input
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // CodeTask not found
					409: ErrorResponseSchema, // Conflict (e.g., codeTask in wrong state)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const { prompt } = request.body;
			if (!prompt) {
				return reply.code(400).send({ error: 'Prompt is required' });
			}
			try {
				await codeTaskService.updateDesignFromInstructions(userId, codeTaskId, prompt);
				return reply.code(202).send({ message: 'Design update accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design update via prompt for codeTask ${codeTaskId}, user ${userId}`);
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
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
		`${basePath}/:codeTaskId/execute-design`,
		{
			schema: {
				params: ParamsSchema,
				response: {
					202: AcceptedResponseSchema,
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // CodeTask not found
					409: ErrorResponseSchema, // Conflict (e.g., codeTask in wrong state, no design)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			try {
				// Assuming codeTaskService.executeDesign exists
				await codeTaskService.executeDesign(userId, codeTaskId);
				return reply.code(202).send({ message: 'Design execution accepted and processing started.' });
			} catch (error: any) {
				fastify.log.error(error, `Error triggering design execution for codeTask ${codeTaskId}, user ${userId}`);
				if (error.message?.includes('not found')) {
					return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
				}
				if (error.message?.includes('state') || error.message?.includes('design')) {
					return reply.code(409).send({ error: error.message || 'Cannot execute design in current state or no design available' });
				}
				return reply.code(500).send({ error: error.message || 'Failed to trigger design execution' });
			}
		},
	);

	// Update the code based on review comments (triggers coding agent)
	fastify.post<{ Params: ParamsType; Body: UpdateCodeBodyType; Reply: Static<typeof ErrorResponseSchema> | null }>(
		`${basePath}/:codeTaskId/update-code`,
		{
			schema: {
				params: ParamsSchema,
				body: UpdateCodeBodySchema,
				response: {
					202: Type.Null({ description: 'Code update accepted and processing started' }),
					400: ErrorResponseSchema, // Invalid input
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // CodeTask not found
					409: ErrorResponseSchema, // Conflict (e.g., codeTask in wrong state)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const data: UpdateCodeReviewData = request.body;
			try {
				await codeTaskService.updateCodeWithComments(userId, codeTaskId, data);
				return reply.code(202).send();
			} catch (error: any) {
				fastify.log.error(error, `Error triggering code update for codeTask ${codeTaskId}, user ${userId}`);
				// Add specific status codes based on error type (e.g., 409 for wrong state)
				return reply.code(500).send({ error: error.message || 'Failed to trigger code update' });
			}
		},
	);

	// Commit the generated code changes to the repository
	fastify.post<{ Params: ParamsType; Body: CommitBodyType; Reply: Static<typeof CommitResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:codeTaskId/commit`,
		{
			schema: {
				params: ParamsSchema,
				body: CommitBodySchema,
				response: {
					200: CommitResponseSchema, // Success, returns commit info
					400: ErrorResponseSchema, // Invalid input
					401: ErrorResponseSchema, // Unauthorized
					404: ErrorResponseSchema, // CodeTask not found
					409: ErrorResponseSchema, // Conflict (e.g., codeTask in wrong state, no code changes)
					500: ErrorResponseSchema, // Internal server error
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const data: CommitChangesData = request.body;
			try {
				const result = await codeTaskService.commitChanges(userId, codeTaskId, data);
				return reply.code(200).send(result); // Assuming synchronous commit for now
			} catch (error: any) {
				fastify.log.error(error, `Error committing changes for codeTask ${codeTaskId}, user ${userId}`);
				// Add specific status codes based on error type (e.g., 409 for wrong state)
				return reply.code(500).send({ error: error.message || 'Failed to commit changes' });
			}
		},
	);

	// --- Helper Methods ---

	// Get a list of branches for a given repository, associated with a Code task
	fastify.get<{ Params: ParamsType; Querystring: GetBranchesQueryType; Reply: Static<typeof GetBranchesResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:codeTaskId/branches`,
		{
			schema: {
				params: ParamsSchema, // For codeTaskId
				querystring: GetBranchesQuerySchema, // For providerType and projectId
				response: {
					200: GetBranchesResponseSchema,
					400: ErrorResponseSchema, // Invalid query params
					401: ErrorResponseSchema,
					404: ErrorResponseSchema, // Repository or codeTask not found/accessible
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const { providerType, projectId } = request.query;
			try {
				const branches = await codeTaskService.getBranchList(userId, codeTaskId, providerType, projectId);
				return reply.send(branches);
			} catch (error: any) {
				fastify.log.error(error, `Error getting branches for codeTask ${codeTaskId}, repo ${projectId} (provider: ${providerType}), user ${userId}`);
				// Add specific status codes (e.g., 404 if repo not found)
				return reply.code(500).send({ error: error.message || 'Failed to get branch list' });
			}
		},
	);

	// Get the file system tree structure for a Code task repository
	fastify.get<{ Params: ParamsType; Querystring: GetTreeQueryType; Reply: Static<typeof GetTreeResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:codeTaskId/tree`,
		{
			schema: {
				params: ParamsSchema,
				querystring: GetTreeQuerySchema,
				response: {
					200: GetTreeResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema, // CodeTask or path not found
					409: ErrorResponseSchema, // CodeTask not initialized/ready
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const { path } = request.query; // path is optional
			try {
				const tree = await codeTaskService.getFileSystemTree(userId, codeTaskId, path);
				return reply.sendJSON(tree);
			} catch (error: any) {
				fastify.log.error(error, `Error getting file system tree for codeTask ${codeTaskId} (path: ${path}), user ${userId}`);
				// Add specific status codes (e.g., 404, 409)
				return reply.code(500).send({ error: error.message || 'Failed to get file system tree' });
			}
		},
	);

	// Get the content of a specific file within a Code task repository
	fastify.get<{ Params: ParamsType; Querystring: GetFileQueryType; Reply: Static<typeof GetFileResponseSchema> | Static<typeof ErrorResponseSchema> }>(
		`${basePath}/:codeTaskId/file`,
		{
			schema: {
				params: ParamsSchema,
				querystring: GetFileQuerySchema,
				response: {
					200: GetFileResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema, // CodeTask or file not found
					409: ErrorResponseSchema, // CodeTask not initialized/ready
					500: ErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const userId = currentUser().id;
			const { codeTaskId } = request.params;
			const { path: filePath } = request.query; // path is required
			try {
				const content = await codeTaskService.getFileContent(userId, codeTaskId, filePath);
				return reply.send({ content });
			} catch (error: any) {
				fastify.log.error(error, `Error getting file content for codeTask ${codeTaskId} (path: ${filePath}), user ${userId}`);
				// Add specific status codes (e.g., 404, 409)
				return reply.code(500).send({ error: error.message || 'Failed to get file content' });
			}
		},
	);
}
