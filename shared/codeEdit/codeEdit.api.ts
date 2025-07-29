import { type Static, Type } from '@sinclair/typebox';
import { defineApiRoute } from '#shared/api-definitions';
import { FileSystemNodeSchema } from '#shared/files/files.schema';
import type { AreTypesFullyCompatible } from '#shared/typeUtils';

const CODE_EDIT_API_BASE = '/api/code-edit';

// --- Schemas for getFilesContent ---

export interface FilesContentRequest {
	filePaths: string[];
}

export type FilesContentResponse = Record<string, string>;

export const FilesContentRequestSchema = Type.Object(
	{
		filePaths: Type.Array(Type.String(), { minItems: 1 }),
	},
	{ $id: 'FilesContentRequest' },
);

export const FilesContentResponseSchema = Type.Record(Type.String(), Type.String(), {
	$id: 'FilesContentResponse',
});

// Compile-time checks to ensure schemas and types are compatible
const _reqCheck: AreTypesFullyCompatible<FilesContentRequest, Static<typeof FilesContentRequestSchema>> = true;
const _resCheck: AreTypesFullyCompatible<FilesContentResponse, Static<typeof FilesContentResponseSchema>> = true;

// --- API Definitions ---

export const CODE_EDIT_API = {
	getFileSystemTree: defineApiRoute('GET', `${CODE_EDIT_API_BASE}/tree`, {
		schema: {
			// This endpoint does not require params, querystring, or a body.
			response: { 200: FileSystemNodeSchema },
		},
	}),

	getFilesContent: defineApiRoute('POST', `${CODE_EDIT_API_BASE}/files-content`, {
		schema: {
			body: FilesContentRequestSchema,
			response: { 200: FilesContentResponseSchema },
		},
	}),
};
