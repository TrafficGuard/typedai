import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest, sendJSON, sendNotFound } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { PROMPT_API } from '#shared/api/prompts.api';
import type { LlmMessage } from '#shared/model/llm.model';
import type { Prompt } from '#shared/model/prompts.model';
import type {
	PromptCreateSchema,
	PromptGenerateFromMessagesPayloadSchema,
	PromptGeneratePayloadSchema,
	PromptGenerateResponseSchemaModel,
	PromptListSchemaModel,
	PromptParamsSchema,
	PromptRevisionParamsSchema,
	PromptSchemaModel,
	PromptUpdateSchema,
} from '#shared/schemas/prompts.schema';
import { currentUser } from '#user/userContext';

export async function promptRoutes(fastify: AppFastifyInstance) {
	/**
	 * List all prompts for the current user.
	 */
	fastify.get(PROMPT_API.listPrompts.pathTemplate, { schema: PROMPT_API.listPrompts.schema }, async (req, reply) => {
		const userId = currentUser().id;
		try {
			const prompts = await fastify.promptsService.listPromptsForUser(userId);
			const promptList: PromptListSchemaModel = {
				prompts: prompts as any,
				hasMore: false,
			};
			reply.sendJSON(promptList);
		} catch (error: any) {
			logger.error({ err: error, userId }, 'Error listing prompts');
			const message = error.message || 'Error listing prompts';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});

	/**
	 * Create a new prompt.
	 */
	fastify.post(PROMPT_API.createPrompt.pathTemplate, { schema: PROMPT_API.createPrompt.schema }, async (req, reply) => {
		const payload = req.body;
		const userId = currentUser().id;

		const promptData: Omit<Prompt, 'id' | 'revisionId' | 'userId'> = {
			parentId: payload.parentId,
			name: payload.name,
			appId: undefined,
			tags: payload.tags ?? [],
			messages: payload.messages as any,
			settings: payload.options as any,
		};

		try {
			const createdPrompt = await fastify.promptsService.createPrompt(promptData, userId);
			reply.code(201);
			reply.sendJSON(createdPrompt);
		} catch (error: any) {
			logger.error({ err: error, userId, payload: promptData }, 'Error creating prompt');
			const message = error.message || 'Error creating prompt';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});

	/**
	 * Get a specific prompt by its ID (latest revision).
	 */
	fastify.get(PROMPT_API.getPromptById.pathTemplate, { schema: PROMPT_API.getPromptById.schema }, async (req, reply) => {
		const { promptId } = req.params;
		const userId = currentUser().id;

		try {
			const prompt = await fastify.promptsService.getPrompt(promptId, userId);
			if (!prompt) return sendNotFound(reply, 'Prompt not found');

			sendJSON(reply, prompt);
		} catch (error: any) {
			logger.error({ err: error, promptId, userId }, 'Error getting prompt by ID');
			const message = error.message || 'Error retrieving prompt';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});

	/**
	 * Get a specific revision of a prompt.
	 */
	fastify.get(PROMPT_API.getPromptRevision.pathTemplate, { schema: PROMPT_API.getPromptRevision.schema }, async (req, reply) => {
		const { promptId, revisionId: revisionIdStr } = req.params;
		const userId = currentUser().id;

		const revisionId = Number.parseInt(revisionIdStr, 10);
		if (Number.isNaN(revisionId)) return sendBadRequest(reply, 'Invalid revision ID format');

		try {
			const prompt = await fastify.promptsService.getPromptVersion(promptId, revisionId, userId);
			if (!prompt) return sendNotFound(reply, 'Prompt revision not found');

			sendJSON(reply, prompt);
		} catch (error: any) {
			logger.error({ err: error, promptId, revisionId, userId }, 'Error getting prompt revision');
			const message = error.message || 'Error retrieving prompt revision';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});

	/**
	 * Update an existing prompt.
	 */
	fastify.patch(PROMPT_API.updatePrompt.pathTemplate, { schema: PROMPT_API.updatePrompt.schema }, async (req, reply) => {
		const { promptId } = req.params;
		const updates = req.body;
		const userId = currentUser().id;

		try {
			const serviceUpdates = {
				...updates,
				...(updates.messages && { messages: updates.messages as any }),
				...(updates.options && { options: updates.options as any }),
			};

			const updatedPrompt = await fastify.promptsService.updatePrompt(promptId, serviceUpdates, userId, false);
			sendJSON(reply, updatedPrompt);
		} catch (error: any) {
			logger.error({ err: error, promptId, userId, updates }, 'Error updating prompt');
			const message = error.message || 'Error updating prompt';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});

	/**
	 * Delete a prompt and all its revisions.
	 */
	fastify.delete(PROMPT_API.deletePrompt.pathTemplate, { schema: PROMPT_API.deletePrompt.schema }, async (req, reply) => {
		const { promptId } = req.params;
		const userId = currentUser().id;

		try {
			await fastify.promptsService.deletePrompt(promptId, userId);
			reply.code(204).send();
		} catch (error: any) {
			logger.error({ err: error, promptId, userId }, 'Error deleting prompt');
			const message = error.message || 'Error deleting prompt';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});

	/**
	 * Generate content from a prompt.
	 */
	fastify.post(PROMPT_API.generateFromPrompt.pathTemplate, { schema: PROMPT_API.generateFromPrompt.schema }, async (req, reply) => {
		const { promptId } = req.params as Static<typeof PromptParamsSchema>; // Ensure Static is imported from @sinclair/typebox
		const payload = req.body as Static<typeof PromptGeneratePayloadSchema>; // Ensure Static is imported
		// const options = payload.options; // 'options' can be extracted if needed for logging or future use
		const userId = currentUser().id;

		logger.info({ promptId, userId, payload }, 'Request to generate content from prompt');

		try {
			// Mock implementation:
			const mockGeneratedMessage: LlmMessage = {
				role: 'assistant',
				content: 'This is a mock generated message from the new /api/prompts/:promptId/generate endpoint.',
				// Ensure LlmMessage structure matches what PromptGenerateResponseSchemaModel expects for generatedMessage.
				// If 'stats' or other fields are mandatory in the schema representation of LlmMessage, they should be added.
				// For example, if LlmMessageSchema requires stats (which it does via LlmMessageSpecificFieldsSchema):
				stats: { requestTime: 0, timeToFirstToken: 0, totalTime: 0, inputTokens: 0, outputTokens: 0, cost: 0, llmId: 'mock-llm' },
				// llmId and time are also optional fields in LlmMessageSpecificFieldsSchema
			};

			const response: PromptGenerateResponseSchemaModel = {
				generatedMessage: mockGeneratedMessage as any, // Using 'as any' to bridge potential minor discrepancies between LlmMessage model and schema during mock phase.
			};

			// Use sendJSON to send the response with a 200 OK status by default.
			sendJSON(reply, response);
		} catch (error: any) {
			logger.error({ err: error, promptId, userId, payload }, 'Error in /api/prompts/:promptId/generate endpoint');
			const message = error.message || 'Error generating content from prompt';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});

	/**
	 * Generate content directly from messages.
	 */
	fastify.post(PROMPT_API.generateFromMessages.pathTemplate, { schema: PROMPT_API.generateFromMessages.schema }, async (req, reply) => {
		const payload = req.body as Static<typeof PromptGenerateFromMessagesPayloadSchema>;
		const userId = currentUser().id;

		logger.info({ userId, payload }, 'Request to generate content from messages');

		try {
			const llmId = payload.options?.llmId || 'default';
			const llm = await fastify.llmFactory.getLLM(llmId);

			const generatedMessage = await llm.generateMessage(payload.messages as any, payload.options as any);

			const response: PromptGenerateResponseSchemaModel = {
				generatedMessage: generatedMessage as any,
			};

			sendJSON(reply, response);
		} catch (error: any) {
			logger.error({ err: error, userId, payload }, 'Error in /api/prompts/generate endpoint');
			const message = error.message || 'Error generating content from messages';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});
}
