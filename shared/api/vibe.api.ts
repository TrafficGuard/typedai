import { Type } from '@sinclair/typebox';
import {
    CreateVibeSessionDataApiSchema, VibeSessionApiSchema, VibeSessionListItemApiSchema,
    UpdateVibeSessionApiBodySchema, UpdateSelectionPromptDataApiSchema, GenerateDesignDataApiSchema,
    VibePresetApiSchema, CreatePresetApiBodySchema, VibePresetConfigApiSchema,
    GetBranchesQueryApiSchema, GetBranchesResponseApiSchema,
    GetTreeQueryApiSchema, GetTreeResponseApiSchema,
    GetFileQueryApiSchema, GetFileResponseApiSchema,
    CommitChangesDataApiSchema, CommitResponseApiSchema,
    UpdateCodeReviewDataApiSchema,
    UpdateDesignPromptDataApiSchema,
} from '../schemas/vibe.schema';

// Common API Schemas
import {
    ApiSessionParamsSchema, ApiErrorResponseSchema, ApiMessageResponseSchema,
    ApiNullResponseSchema, ApiPresetParamsSchema,
} from '../schemas/common.schema';
import {defineRoute} from "#shared/api-definitions";


const VIBE_API_BASE = '/api/vibe';

export const VIBE_API = {

        // Session CRUD
        create: defineRoute('POST', `${VIBE_API_BASE}`, {
            schema: { body: CreateVibeSessionDataApiSchema, response: { 201: VibeSessionApiSchema } }
        }),
        list: defineRoute('GET', `${VIBE_API_BASE}`, {
            schema: { response: { 200: Type.Array(VibeSessionListItemApiSchema) } }
        }),
        getById: defineRoute('GET', `${VIBE_API_BASE}/:sessionId`, {
            schema: { path: ApiSessionParamsSchema, response: { 200: VibeSessionApiSchema } }
        }),
        update: defineRoute('PATCH', `${VIBE_API_BASE}/:sessionId`, { // Matches PATCH in vibeRoutes.ts
            schema: { path: ApiSessionParamsSchema, body: UpdateVibeSessionApiBodySchema, response: { 204: ApiNullResponseSchema } }
        }),
        delete: defineRoute('DELETE', `${VIBE_API_BASE}/:sessionId`, {
            schema: { path: ApiSessionParamsSchema, response: { 204: ApiNullResponseSchema } }
        }),

        // Presets
        createPreset: defineRoute('POST', `${VIBE_API_BASE}/presets`, {
            schema: { body: CreatePresetApiBodySchema, response: { 201: VibePresetApiSchema } }
        }),
        listPresets: defineRoute('GET', `${VIBE_API_BASE}/presets`, {
            schema: { response: { 200: Type.Array(VibePresetApiSchema), 500: ApiErrorResponseSchema } }
        }),
        deletePreset: defineRoute('DELETE', `${VIBE_API_BASE}/presets/:presetId`, { // Matches :presetId
            schema: { path: ApiPresetParamsSchema, response: { 204: ApiNullResponseSchema } }
        }),

        // Workflow Actions
        updateSelectionPrompt: defineRoute('POST', `${VIBE_API_BASE}/:sessionId/update-selection`, {
            schema: { path: ApiSessionParamsSchema, body: UpdateSelectionPromptDataApiSchema, response: { 202: ApiMessageResponseSchema } }
        }),
        generateDesign: defineRoute('POST', `${VIBE_API_BASE}/:sessionId/generate-design`, {
            schema: { path: ApiSessionParamsSchema, body: GenerateDesignDataApiSchema, response: { 202: ApiMessageResponseSchema } }
        }),
        updateDesign: defineRoute('POST', `${VIBE_API_BASE}/:sessionId/update-design`, { // New from vibeRoutes.ts
            // Assuming simple body

            schema: { path: ApiSessionParamsSchema, body: Type.Object({ design: Type.String() }) , response: { 202: ApiMessageResponseSchema } }
        }),
        updateDesignPrompt: defineRoute('POST', `${VIBE_API_BASE}/:sessionId/update-design-prompt`, { // Renamed from update-design-instructions
            schema: { path: ApiSessionParamsSchema, body: UpdateDesignPromptDataApiSchema, response: { 202: ApiMessageResponseSchema } }
        }),
        executeDesign: defineRoute('POST', `${VIBE_API_BASE}/:sessionId/execute-design`, {
            schema: { path: ApiSessionParamsSchema, response: { 202: ApiMessageResponseSchema } }
        }),
        resetSelection: defineRoute('POST', `${VIBE_API_BASE}/:sessionId/reset-selection`, {
            schema: { path: ApiSessionParamsSchema, response: { 202: ApiMessageResponseSchema } }
        }),
        updateCode: defineRoute('POST', `${VIBE_API_BASE}/:sessionId/update-code`, {
            // vibeRoutes has Null
            schema: { path: ApiSessionParamsSchema, body: UpdateCodeReviewDataApiSchema, response: { 202: ApiNullResponseSchema } }
        }),
        commitChanges: defineRoute('POST', `${VIBE_API_BASE}/:sessionId/commit`, {
            schema: { path: ApiSessionParamsSchema, body: CommitChangesDataApiSchema, response: { 200: CommitResponseApiSchema } }
        }),

        // Helpers
        getRepoBranches: defineRoute('GET', `${VIBE_API_BASE}/:sessionId/branches`, {
            schema: { path: ApiSessionParamsSchema, querystring: GetBranchesQueryApiSchema, response: { 200: GetBranchesResponseApiSchema } }
        }),
        getFileSystemTree: defineRoute('GET', `${VIBE_API_BASE}/:sessionId/tree`, {
            schema: { path: ApiSessionParamsSchema, querystring: GetTreeQueryApiSchema, response: { 200: GetTreeResponseApiSchema } }
        }),
        getFileContent: defineRoute('GET', `${VIBE_API_BASE}/:sessionId/file`, {
            schema: { path: ApiSessionParamsSchema, querystring: GetFileQueryApiSchema, response: { 200: GetFileResponseApiSchema } }
        }),
};
