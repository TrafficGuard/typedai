import { Type } from '@sinclair/typebox';

export const ApiErrorResponseSchema = Type.Object({
	error: Type.String(),
});

export const ApiMessageResponseSchema = Type.Object({
	message: Type.String(),
});

export const ResponseMessageSchema = Type.Object({
	message: Type.String(),
});

// Common path parameter schemas
export const ApiSessionParamsSchema = Type.Object({
	codeTaskId: Type.String({ description: 'The ID of the Code task' }),
});

export const ApiIdParamsSchema = Type.Object({
	id: Type.String({ description: 'A generic ID parameter' }),
});

export const ApiPresetParamsSchema = Type.Object({
	presetId: Type.String({ description: 'The ID of the Code task preset' }),
});

// Schema for an empty success response (e.g., 204 No Content)
export const ApiNullResponseSchema = Type.Null();

export const Nullish = Type.Union([Type.Optional(Type.Null()), Type.Undefined()]);
