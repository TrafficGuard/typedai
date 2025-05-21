import { Type } from '@sinclair/typebox';
import { defineRoute } from '#shared/api-definitions';
import {
	BulkDeleteRequestSchema,
	CodeReviewConfigCreateSchema,
	CodeReviewConfigListResponseSchema,
	CodeReviewConfigSchema,
	CodeReviewConfigUpdateSchema,
	MessageResponseSchema,
} from '#shared/schemas/codeReview.schema';

const API_PREFIX = '/api/code-review-configs';

export const CODE_REVIEW_API = {
	list: defineRoute('GET', API_PREFIX, { schema: { response: { 200: CodeReviewConfigListResponseSchema } } }),
	getById: defineRoute('GET', `${API_PREFIX}/:id`, { schema: { path: Type.Object({ id: Type.String() }), response: { 200: CodeReviewConfigSchema } } }),
	create: defineRoute('POST', API_PREFIX, { schema: { body: CodeReviewConfigCreateSchema, response: { 201: MessageResponseSchema } } }),
	update: defineRoute('PUT', `${API_PREFIX}/:id`, {
		schema: { path: Type.Object({ id: Type.String() }), body: CodeReviewConfigUpdateSchema, response: { 200: MessageResponseSchema } },
	}),
	delete: defineRoute('DELETE', `${API_PREFIX}/:id`, { schema: { path: Type.Object({ id: Type.String() }), response: { 200: MessageResponseSchema } } }),
	bulkDelete: defineRoute('POST', `${API_PREFIX}/bulk-delete`, { schema: { body: BulkDeleteRequestSchema, response: { 200: MessageResponseSchema } } }),
};
