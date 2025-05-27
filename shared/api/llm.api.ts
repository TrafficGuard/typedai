import { defineRoute } from '#shared/api-definitions';

const LLMS_BASE = '/api/llms';

export const LLMS_API = {
	list: defineRoute('GET', `${LLMS_BASE}/list`, {
		schema: {
			response: {
				// 200: LlmsSchema,
			},
		},
	}),
};
