import { type Static, Type } from '@sinclair/typebox';
import type { CodeReviewConfig, IExample } from '#shared/model/codeReview.model';
import type { AreTypesFullyCompatible } from '#shared/utils/type-compatibility';

export const IExampleSchema = Type.Object({
	code: Type.String(),
	reviewComment: Type.String(),
});
const _iExampleApiCheck: AreTypesFullyCompatible<IExample, Static<typeof IExampleSchema>> = true;

export const CodeReviewConfigSchema = Type.Object({
	id: Type.String(),
	title: Type.String(),
	enabled: Type.Boolean(),
	description: Type.String(),
	fileExtensions: Type.Object({
		include: Type.Array(Type.String()),
	}),
	requires: Type.Object({
		text: Type.Array(Type.String()),
	}),
	tags: Type.Array(Type.String()),
	projectPaths: Type.Array(Type.String()),
	examples: Type.Array(IExampleSchema),
});
const _codeReviewConfigApiCheck: AreTypesFullyCompatible<CodeReviewConfig, Static<typeof CodeReviewConfigSchema>> = true;

export const CodeReviewConfigCreateKeys = ['title', 'enabled', 'description', 'fileExtensions', 'requires', 'tags', 'projectPaths', 'examples'] as const;
export type CodeReviewConfigCreate = Pick<CodeReviewConfig, (typeof CodeReviewConfigCreateKeys)[number]>;
export const CodeReviewConfigCreateSchema = Type.Pick(CodeReviewConfigSchema, CodeReviewConfigCreateKeys);
const _codeReviewConfigCreateApiCheck: AreTypesFullyCompatible<CodeReviewConfigCreate, Static<typeof CodeReviewConfigCreateSchema>> = true;

// For updates, all properties except 'id' are considered updatable and must be provided in the payload, mimicking the user profile update pattern.
export const CodeReviewConfigUpdateKeys = ['title', 'enabled', 'description', 'fileExtensions', 'requires', 'tags', 'projectPaths', 'examples'] as const;
export type CodeReviewConfigUpdate = Pick<CodeReviewConfig, (typeof CodeReviewConfigUpdateKeys)[number]>;
export const CodeReviewConfigUpdateSchema = Type.Pick(CodeReviewConfigSchema, CodeReviewConfigUpdateKeys);
const _codeReviewConfigUpdateApiCheck: AreTypesFullyCompatible<CodeReviewConfigUpdate, Static<typeof CodeReviewConfigUpdateSchema>> = true;

export const MessageResponseSchema = Type.Object({
	message: Type.String(),
});
export type MessageResponse = Static<typeof MessageResponseSchema>;

export const BulkDeleteRequestSchema = Type.Object({
	ids: Type.Array(Type.String()),
});
export type BulkDeleteRequest = Static<typeof BulkDeleteRequestSchema>;

export const CodeReviewConfigListResponseSchema = Type.Array(CodeReviewConfigSchema);
export type CodeReviewConfigListResponse = Static<typeof CodeReviewConfigListResponseSchema>;
