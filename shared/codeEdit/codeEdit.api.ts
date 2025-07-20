import { defineApiRoute } from '#shared/api-definitions';
import { FileSystemNodeSchema } from '#shared/files/files.schema';

const CODE_EDIT_API_BASE = '/api/code-edit';

export const CODE_EDIT_API = {
	getFileSystemTree: defineApiRoute('GET', `${CODE_EDIT_API_BASE}/tree`, {
		schema: {
			// This endpoint does not require params, querystring, or a body.
			response: { 200: FileSystemNodeSchema },
		},
	}),
};
