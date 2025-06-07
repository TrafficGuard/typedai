import { Type } from '@sinclair/typebox';
import { defineApiRoute } from '#shared/api-definitions';
import {
	BulkDeleteRequestSchema,
	CodeReviewConfigCreateSchema,
	CodeReviewConfigListResponseSchema,
	CodeReviewConfigSchema,
	CodeReviewConfigUpdateSchema,
	MessageResponseSchema,
} from '#shared/codeReview/codeReview.schema';

const API_PREFIX = '/api/code-review-configs';

export const CODE_REVIEW_API = {
	list: defineApiRoute('GET', API_PREFIX, { schema: { response: { 200: CodeReviewConfigListResponseSchema } } }),
	getById: defineApiRoute('GET', `${API_PREFIX}/:id`, { schema: { params: Type.Object({ id: Type.String() }), response: { 200: CodeReviewConfigSchema } } }),
	create: defineApiRoute('POST', API_PREFIX, { schema: { body: CodeReviewConfigCreateSchema, response: { 201: MessageResponseSchema } } }),
	update: defineApiRoute('PUT', `${API_PREFIX}/:id`, {
		schema: { params: Type.Object({ id: Type.String() }), body: CodeReviewConfigUpdateSchema, response: { 200: MessageResponseSchema } },
	}),
	delete: defineApiRoute('DELETE', `${API_PREFIX}/:id`, { schema: { params: Type.Object({ id: Type.String() }), response: { 200: MessageResponseSchema } } }),
	bulkDelete: defineApiRoute('POST', `${API_PREFIX}/bulk-delete`, { schema: { body: BulkDeleteRequestSchema, response: { 200: MessageResponseSchema } } }),
};
