import { randomUUID } from 'node:crypto';
import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest, sendJSON, sendNotFound } from '#fastify/responses'; // sendJSON is on reply in original spec, but is a standalone function
import { logger } from '#o11y/logger';
import { PROMPT_API } from '#shared/api/prompts.api';
// Prompt model is used for constructing the object for create, if needed by service.
import type { Prompt } from '#shared/model/prompts.model';
import type {
	PromptCreateSchema,
	PromptListSchemaModel,
	PromptParamsSchema,
	PromptRevisionParamsSchema,
	// Schema models for casting responses
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
			// Service returns PromptPreview[]
			const prompts = await fastify.promptsService.listPromptsForUser(userId);
			// Construct the PromptListSchemaModel structure
			const promptList: PromptListSchemaModel = {
				prompts: prompts as any, // Cast to any to satisfy schema, actual type is PromptPreview[]
				hasMore: false, // Assuming no pagination for now, or service needs update
			};
			sendJSON(reply, promptList);
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
		const payload = req.body as Static<typeof PromptCreateSchema>;
		const userId = currentUser().id;

		// Construct the data for the service, excluding id, revisionId, and userId as per PromptsService interface
		const promptData: Omit<Prompt, 'id' | 'revisionId' | 'userId'> = {
			parentId: payload.parentId,
			name: payload.name,
			appId: undefined, // Not in create payload, defaults to undefined
			tags: payload.tags ?? [],
			messages: payload.messages as any, // Cast for schema vs model type compatibility
			options: payload.options as any, // Cast for schema vs model type compatibility
		};

		try {
			const createdPrompt = await fastify.promptsService.createPrompt(promptData, userId);
			// The schema for response is PromptSchema, so cast to PromptSchemaModel
			reply.code(201);
			sendJSON(reply, createdPrompt as PromptSchemaModel);
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
		const { promptId } = req.params as Static<typeof PromptParamsSchema>;
		const userId = currentUser().id;

		try {
			// As per requirement: service method is getPromptById
			const prompt = await fastify.promptsService.getPrompt(promptId, userId);
			if (!prompt) {
				return sendNotFound(reply, 'Prompt not found');
			}
			// The schema for response is PromptSchema, so cast to PromptSchemaModel
			sendJSON(reply, prompt as PromptSchemaModel);
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
		const { promptId, revisionId: revisionIdStr } = req.params as Static<typeof PromptRevisionParamsSchema>;
		const userId = currentUser().id;

		const revisionId = Number.parseInt(revisionIdStr, 10);
		if (Number.isNaN(revisionId)) {
			return sendBadRequest(reply, 'Invalid revision ID format');
		}

		try {
			// As per requirement: service method is getPromptRevision
			const prompt = await fastify.promptsService.getPromptVersion(promptId, revisionId, userId);
			if (!prompt) {
				return sendNotFound(reply, 'Prompt revision not found');
			}
			// The schema for response is PromptSchema, so cast to PromptSchemaModel
			sendJSON(reply, prompt as PromptSchemaModel);
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
		const { promptId } = req.params as Static<typeof PromptParamsSchema>;
		const updates = req.body as Static<typeof PromptUpdateSchema>;
		const userId = currentUser().id;

		try {
			// As per requirement: service call is updatePrompt(promptId, updates, userId)
			// This implies the service method does not require a 'newVersion' boolean from the handler.
			// If underlying service needs casting for messages/options:
			const serviceUpdates = {
				...updates,
				...(updates.messages && { messages: updates.messages as any }),
				...(updates.options && { options: updates.options as any }),
			};

			// Assuming PATCH updates the current revision, so newVersion is false.
			const updatedPrompt = await fastify.promptsService.updatePrompt(promptId, serviceUpdates, userId, false);
			// The schema for response is PromptSchema, so cast to PromptSchemaModel
			sendJSON(reply, updatedPrompt as PromptSchemaModel);
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
		const { promptId } = req.params as Static<typeof PromptParamsSchema>;
		const userId = currentUser().id;

		try {
			await fastify.promptsService.deletePrompt(promptId, userId);
			// Response schema is ApiNullResponseSchema, resulting in 204 No Content
			reply.code(204).send();
		} catch (error: any) {
			logger.error({ err: error, promptId, userId }, 'Error deleting prompt');
			const message = error.message || 'Error deleting prompt';
			const statusCode = typeof error.statusCode === 'number' ? error.statusCode : 500;
			reply.code(statusCode).send({ error: message });
		}
	});
}
