import { Type } from '@sinclair/typebox';
import {
	CodeTaskApiSchema,
	CodeTaskListItemApiSchema,
	CodeTaskPresetApiSchema,
	CommitChangesDataApiSchema,
	CommitResponseApiSchema,
	CreateCodeTaskDataApiSchema,
	CreatePresetApiBodySchema,
	GenerateDesignDataApiSchema,
	GetBranchesQueryApiSchema,
	GetBranchesResponseApiSchema,
	GetFileQueryApiSchema,
	GetFileResponseApiSchema,
	GetTreeQueryApiSchema,
	GetTreeResponseApiSchema,
	UpdateCodeReviewDataApiSchema,
	UpdateCodeTaskApiBodySchema,
	UpdateDesignPromptDataApiSchema,
	UpdateSelectionPromptDataApiSchema,
} from './codeTask.schema';

import { defineRoute } from '#shared/api-definitions';
// Common API Schemas
import { ApiMessageResponseSchema, ApiNullResponseSchema, ApiPresetParamsSchema, ApiSessionParamsSchema } from '../common.schema';

const CODE_TASK_API_BASE = '/api/codeTask';

export const CODE_TASK_API = {
	// Session CRUD
	create: defineRoute('POST', `${CODE_TASK_API_BASE}`, {
		schema: { body: CreateCodeTaskDataApiSchema, response: { 201: CodeTaskApiSchema } },
	}),
	list: defineRoute('GET', `${CODE_TASK_API_BASE}`, {
		schema: { response: { 200: Type.Array(CodeTaskListItemApiSchema) } },
	}),
	getById: defineRoute('GET', `${CODE_TASK_API_BASE}/:codeTaskId`, {
		schema: { params: ApiSessionParamsSchema, response: { 200: CodeTaskApiSchema } },
	}),
	update: defineRoute('PATCH', `${CODE_TASK_API_BASE}/:codeTaskId`, {
		// Matches PATCH in codeTaskRoutes.ts
		schema: { params: ApiSessionParamsSchema, body: UpdateCodeTaskApiBodySchema, response: { 204: ApiNullResponseSchema } },
	}),
	delete: defineRoute('DELETE', `${CODE_TASK_API_BASE}/:codeTaskId`, {
		schema: { params: ApiSessionParamsSchema, response: { 204: ApiNullResponseSchema } },
	}),

	// Presets
	createPreset: defineRoute('POST', `${CODE_TASK_API_BASE}/presets`, {
		schema: { body: CreatePresetApiBodySchema, response: { 201: CodeTaskPresetApiSchema } },
	}),
	listPresets: defineRoute('GET', `${CODE_TASK_API_BASE}/presets`, {
		schema: { response: { 200: Type.Array(CodeTaskPresetApiSchema) } },
	}),
	deletePreset: defineRoute('DELETE', `${CODE_TASK_API_BASE}/presets/:presetId`, {
		// Matches :presetId
		schema: { params: ApiPresetParamsSchema, response: { 204: ApiNullResponseSchema } },
	}),

	// Workflow Actions
	updateSelectionPrompt: defineRoute('POST', `${CODE_TASK_API_BASE}/:codeTaskId/update-selection`, {
		schema: { params: ApiSessionParamsSchema, body: UpdateSelectionPromptDataApiSchema, response: { 202: ApiMessageResponseSchema } },
	}),
	generateDesign: defineRoute('POST', `${CODE_TASK_API_BASE}/:codeTaskId/generate-design`, {
		schema: { params: ApiSessionParamsSchema, body: GenerateDesignDataApiSchema, response: { 202: ApiMessageResponseSchema } },
	}),
	updateDesign: defineRoute('POST', `${CODE_TASK_API_BASE}/:codeTaskId/update-design`, {
		// New from codeTaskRoutes.ts
		// Assuming simple body

		schema: { params: ApiSessionParamsSchema, body: Type.Object({ design: Type.String() }), response: { 202: ApiMessageResponseSchema } },
	}),
	updateDesignPrompt: defineRoute('POST', `${CODE_TASK_API_BASE}/:codeTaskId/update-design-prompt`, {
		// Renamed from update-design-instructions
		schema: { params: ApiSessionParamsSchema, body: UpdateDesignPromptDataApiSchema, response: { 202: ApiMessageResponseSchema } },
	}),
	executeDesign: defineRoute('POST', `${CODE_TASK_API_BASE}/:codeTaskId/execute-design`, {
		schema: { params: ApiSessionParamsSchema, response: { 202: ApiMessageResponseSchema } },
	}),
	resetSelection: defineRoute('POST', `${CODE_TASK_API_BASE}/:codeTaskId/reset-selection`, {
		schema: { params: ApiSessionParamsSchema, response: { 202: ApiMessageResponseSchema } },
	}),
	updateCode: defineRoute('POST', `${CODE_TASK_API_BASE}/:codeTaskId/update-code`, {
		// codeTaskRoutes has Null
		schema: { params: ApiSessionParamsSchema, body: UpdateCodeReviewDataApiSchema, response: { 202: ApiNullResponseSchema } },
	}),
	commitChanges: defineRoute('POST', `${CODE_TASK_API_BASE}/:codeTaskId/commit`, {
		schema: { params: ApiSessionParamsSchema, body: CommitChangesDataApiSchema, response: { 200: CommitResponseApiSchema } },
	}),

	// Helpers
	getRepoBranches: defineRoute('GET', `${CODE_TASK_API_BASE}/:codeTaskId/branches`, {
		schema: { params: ApiSessionParamsSchema, querystring: GetBranchesQueryApiSchema, response: { 200: GetBranchesResponseApiSchema } },
	}),
	getFileSystemTree: defineRoute('GET', `${CODE_TASK_API_BASE}/:codeTaskId/tree`, {
		schema: { params: ApiSessionParamsSchema, querystring: GetTreeQueryApiSchema, response: { 200: GetTreeResponseApiSchema } },
	}),
	getFileContent: defineRoute('GET', `${CODE_TASK_API_BASE}/:codeTaskId/file`, {
		schema: { params: ApiSessionParamsSchema, querystring: GetFileQueryApiSchema, response: { 200: GetFileResponseApiSchema } },
	}),
};
