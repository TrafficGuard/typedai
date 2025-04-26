import { type Static, Type } from '@sinclair/typebox';
import { type Static, Type } from '@sinclair/typebox';
import type { FastifyRequest as FastifyRequestBase } from 'fastify'; // Import base FastifyRequest
import type { AppFastifyInstance } from '#applicationTypes';
import type { FastifyRequest } from '#fastify/fastifyApp'; // Keep custom FastifyRequest for non-generic use
import type { GitProject } from '#functions/scm/gitProject';
import { type SelectedFile, queryWithFileSelection } from '#swe/discovery/selectFilesAgent'; // Import agent and type
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

// Schema for the initialise endpoint path parameter
const InitialiseParamsSchema = Type.Object({
	id: Type.String({ description: 'The ID of the Vibe session to initialise' }),
});

// Schema for the initialise endpoint success response (updated)
const InitialiseSuccessResponseSchema = Type.Object({
	message: Type.String(),
	sessionId: Type.String(),
	status: Type.String(), // Reflect the status after initialization steps
	// clonedPathValue is internal, not usually returned to client
});

export async function vibeRoutes(fastify: AppFastifyInstance) {
	// Access services from the application context attached to fastify
	const vibeService = fastify.vibeService;
	const scmService = fastify.scmService;
	const fileSystemService = fastify.fileSystemService;

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

	// --- POST /initialise/:id ---
	fastify.post(
		'/initialise/:id',
		{
			schema: {
				params: InitialiseParamsSchema,
				response: {
					200: InitialiseSuccessResponseSchema,
					400: ErrorResponseSchema,
					401: ErrorResponseSchema,
					404: ErrorResponseSchema,
					500: ErrorResponseSchema,
				},
			},
		},
		// Use FastifyRequestBase for generic type with Params
		async (request: FastifyRequestBase<{ Params: Static<typeof InitialiseParamsSchema> }>, reply) => {
			// Cast to custom FastifyRequest to access currentUser
			const req = request as FastifyRequest;
			if (!req.currentUser?.id) {
				return reply.code(401).send({ error: 'Unauthorized' });
			}
			const userId = req.currentUser.id;
			const { id } = request.params; // Get id from validated params

			try {
				// Get the Vibe session details
				const session = await vibeService.getVibeSession(userId, id);
				if (!session) {
					return reply.code(404).send({ error: 'Vibe session not found' });
				}

				const { repositorySource, repositoryId, branch } = session;
				let clonedPath: string;

				if (repositorySource === 'local') {
					fastify.log.warn(`Vibe session ${id} uses local repository source. Using repositoryId as path.`);
					clonedPath = repositoryId; // Use the provided path directly
				} else {
					// Get the configured SCM provider
					const provider = scmService.getProvider(repositorySource);
					if (!provider) {
						fastify.log.warn(`SCM provider '${repositorySource}' requested by session ${id} is not configured.`);
						return reply.code(400).send({ error: `Configured SCM provider not found for source: ${repositorySource}` });
					}

					// Clone the project using the provider
					clonedPath = await provider.cloneProject(repositoryId, branch);
				}

				// Validate clonedPath
				if (!clonedPath || typeof clonedPath !== 'string') {
					fastify.log.error({ clonedPath, sessionId: id }, 'Invalid cloned path received after clone/local setup.');
					return reply.code(500).send({ error: 'Failed to determine repository path after setup.' });
				}

				// Log the result and set working directory
				fastify.log.info({ clonedPathValue: clonedPath, sessionId: id }, 'Repository path determined. Setting working directory.');
				await fileSystemService.setWorkingDirectory(clonedPath);

				// Handle optional new branch creation
				const { newBranchName } = session;
				if (newBranchName) {
					try {
						fastify.log.info({ newBranchName, sessionId: id }, 'Attempting to create and switch to new branch.');
						const vcs = fileSystemService.getVcs(); // Throws if not a VCS repo
						await vcs.createBranch(newBranchName);
						await vcs.switchToBranch(newBranchName);
						fastify.log.info({ newBranchName, sessionId: id }, 'Successfully created and switched to branch.');
					} catch (branchError) {
						fastify.log.error(branchError, `Failed to create or switch to new branch '${newBranchName}' for session ${id}. Proceeding on original branch.`);
						// Decide if this is a fatal error or just a warning. For now, log and continue.
						// return reply.code(500).send({ error: `Failed to create or switch to branch: ${branchError.message}` });
					}
				}

				// --- File Selection and Design Generation Step ---
				fastify.log.info({ sessionId: id }, 'Starting file selection and design generation.');
				await vibeService.updateVibeSession(userId, id, { status: 'selecting_files' }); // Keep status as selecting_files during the process

				try {
					// Run the agent to select files and generate the initial design/answer
					// Note: This runs synchronously in the request handler. For long-running tasks,
					// consider moving this to a background job queue.
					const { files: selectedFiles, answer: designAnswer } = await queryWithFileSelection(session.instructions /*, projectInfo */); // Pass projectInfo if available/needed
					fastify.log.info({ sessionId: id, fileCount: selectedFiles.length }, 'File selection and design generation complete.');

					// Update the session with selected files, the design answer, and set status to 'design'
					await vibeService.updateVibeSession(userId, id, {
						fileSelection: selectedFiles,
						designAnswer: designAnswer, // Add the design answer
						status: 'design',
					});
					fastify.log.info({ sessionId: id }, 'Vibe session updated with selected files, design, and status set to design.');
				} catch (fileAgentError) {
					fastify.log.error(fileAgentError, `Error during file selection or design generation for session ${id}`);
					// Update session status to error
					await vibeService.updateVibeSession(userId, id, { status: 'error', error: `File selection failed: ${fileAgentError.message}` });
					return reply.code(500).send({ error: 'Failed during file selection phase.' });
				}

				// Return success response indicating initialization, file selection, and design generation are done
				return reply.code(200).send({
					message: 'Initialization complete. File selection and design generated.',
					sessionId: id,
					status: 'design', // Reflect the final status after this step
				});
			} catch (error) {
				fastify.log.error(error, `Error during initial vibe session setup for session ${id}`);
				// Attempt to update session status to error if possible (session might not exist or other issues)
				try {
					await vibeService.updateVibeSession(userId, id, { status: 'error', error: `Initial setup failed: ${error.message}` });
				} catch (updateError) {
					fastify.log.error(updateError, `Failed to update session ${id} status to error after initial setup failure.`);
				}
				return reply.code(500).send({ error: 'Failed during initial setup (repository handling or file selection trigger)' });
			}
		},
	);

	// Add other vibe routes here if needed in the future (e.g., GET /sessions/:id, PUT /sessions/:id, etc.)
}
