import { type Static, Type } from '@sinclair/typebox';
import type { AreTypesFullyCompatible } from '#shared/typeUtils';
import type { FileSystemNode } from './fileSystemService';

export const FileSystemNodeSchema = Type.Recursive(
	(Self) =>
		Type.Object({
			path: Type.String(),
			name: Type.String(),
			type: Type.Union([Type.Literal('file'), Type.Literal('directory')]),
			children: Type.Optional(Type.Array(Self)),
			summary: Type.Optional(Type.String()),
		}),
	{ $id: 'FileSystemNode' },
);

// Perform a compile-time check to ensure the schema and interface are compatible.
const _FileSystemNodeCheck: AreTypesFullyCompatible<FileSystemNode, Static<typeof FileSystemNodeSchema>> = true;
