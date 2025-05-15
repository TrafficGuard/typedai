import { defineRoute } from '#shared/api-definitions';
import {
    PromptListSchema,
    PromptSchema,
    PromptParamsSchema,
    PromptCreateSchema,
    PromptUpdateSchema,
    PromptRevisionParamsSchema,
} from '../schemas/prompts.schema';
import { ApiNullResponseSchema } from '#shared/schemas/common.schema';

const PROMPTS_BASE = '/api/prompts';

export const PROMPT_API = {
    listPrompts: defineRoute('GET', `${PROMPTS_BASE}`, {
        schema: {
            response: {
                200: PromptListSchema,
            },
        },
    }),
    createPrompt: defineRoute('POST', `${PROMPTS_BASE}`, {
        schema: {
            body: PromptCreateSchema,
            response: {
                201: PromptSchema,
            },
        },
    }),
    getPromptById: defineRoute('GET', `${PROMPTS_BASE}/:promptId`, {
        schema: {
            path: PromptParamsSchema,
            response: {
                200: PromptSchema,
            },
        },
    }),
    getPromptRevision: defineRoute('GET', `${PROMPTS_BASE}/:promptId/revisions/:revisionId`, {
        schema: {
            path: PromptRevisionParamsSchema,
            response: {
                200: PromptSchema,
            },
        },
    }),
    updatePrompt: defineRoute('PATCH', `${PROMPTS_BASE}/:promptId`, {
        schema: {
            path: PromptParamsSchema,
            body: PromptUpdateSchema,
            response: {
                200: PromptSchema,
            },
        },
    }),
    deletePrompt: defineRoute('DELETE', `${PROMPTS_BASE}/:promptId`, {
        schema: {
            path: PromptParamsSchema,
            response: {
                204: ApiNullResponseSchema,
            },
        },
    }),
};
