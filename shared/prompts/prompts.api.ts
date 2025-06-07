import { defineApiRoute } from '#shared/api-definitions';
import { ApiNullResponseSchema } from '#shared/common.schema';
import {
	PromptCreateSchema,
	PromptGenerateFromMessagesPayloadSchema,
	PromptGeneratePayloadSchema,
	PromptGenerateResponseSchema,
	PromptListSchema,
	PromptParamsSchema,
	PromptRevisionParamsSchema,
	PromptSchema,
	PromptUpdateSchema,
} from './prompts.schema';

const PROMPTS_BASE = '/api/prompts';

export const PROMPT_API = {
	listPrompts: defineApiRoute('GET', `${PROMPTS_BASE}`, {
		schema: {
			response: {
				200: PromptListSchema,
			},
		},
	}),
	createPrompt: defineApiRoute('POST', `${PROMPTS_BASE}`, {
		schema: {
			body: PromptCreateSchema,
			response: {
				201: PromptSchema,
			},
		},
	}),
	getPromptById: defineApiRoute('GET', `${PROMPTS_BASE}/:promptId`, {
		schema: {
			params: PromptParamsSchema,
			response: {
				200: PromptSchema,
			},
		},
	}),
	getPromptRevision: defineApiRoute('GET', `${PROMPTS_BASE}/:promptId/revisions/:revisionId`, {
		schema: {
			params: PromptRevisionParamsSchema,
			response: {
				200: PromptSchema,
			},
		},
	}),
	updatePrompt: defineApiRoute('PATCH', `${PROMPTS_BASE}/:promptId`, {
		schema: {
			params: PromptParamsSchema,
			body: PromptUpdateSchema,
			response: {
				200: PromptSchema,
			},
		},
	}),
	deletePrompt: defineApiRoute('DELETE', `${PROMPTS_BASE}/:promptId`, {
		schema: {
			params: PromptParamsSchema,
			response: {
				204: ApiNullResponseSchema,
			},
		},
	}),
	generateFromPrompt: defineApiRoute('POST', `${PROMPTS_BASE}/:promptId/generate`, {
		schema: {
			params: PromptParamsSchema, // Existing schema for promptId
			body: PromptGeneratePayloadSchema, // New schema for request body
			response: {
				200: PromptGenerateResponseSchema, // New schema for successful response
			},
		},
	}),
	generateFromMessages: defineApiRoute('POST', `${PROMPTS_BASE}/generate`, {
		schema: {
			body: PromptGenerateFromMessagesPayloadSchema,
			response: {
				200: PromptGenerateResponseSchema,
			},
		},
	}),
};
