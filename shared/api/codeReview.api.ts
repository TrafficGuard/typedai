import { Type } from '@sinclair/typebox';
import { defineRoute } from '#shared/api-definitions';
import { CodeReviewConfigCreateSchema, CodeReviewConfigSchema, CodeReviewConfigUpdateSchema } from '#shared/schemas/codeReview.schema';
import { ApiNullResponseSchema, ResponseMessageSchema } from '#shared/schemas/common.schema';

const CODE_REVIEW_CONFIG_BASE = '/api/code-review-configs';

export const CODE_REVIEW_API = {
	list: defineRoute('GET', CODE_REVIEW_CONFIG_BASE, {
		schema: {
			response: {
				200: Type.Array(CodeReviewConfigSchema),
			},
		},
	}),
	getById: defineRoute('GET', `${CODE_REVIEW_CONFIG_BASE}/:id`, {
		schema: {
			params: Type.Object({ id: Type.String() }),
			response: {
				200: CodeReviewConfigSchema,
				404: ResponseMessageSchema, // For "Config not found"
			},
		},
	}),
	create: defineRoute('POST', CODE_REVIEW_CONFIG_BASE, {
		schema: {
			body: CodeReviewConfigCreateSchema,
			response: {
				200: ResponseMessageSchema, // e.g., { message: "Config created with ID: xyz" }
			},
		},
	}),
	update: defineRoute('PUT', `${CODE_REVIEW_CONFIG_BASE}/:id`, {
		schema: {
			params: Type.Object({ id: Type.String() }),
			body: CodeReviewConfigUpdateSchema,
			response: {
				200: ResponseMessageSchema, // e.g., { message: "Config updated successfully" }
			},
		},
	}),
	delete: defineRoute('DELETE', `${CODE_REVIEW_CONFIG_BASE}/:id`, {
		schema: {
			params: Type.Object({ id: Type.String() }),
			response: {
				200: ResponseMessageSchema, // e.g., { message: "Config deleted successfully" }
			},
		},
	}),
};
