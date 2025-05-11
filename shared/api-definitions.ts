import { Type, type TSchema } from '@sinclair/typebox';
// Vibe API Schemas
import {
    CreateVibeSessionDataApiSchema, VibeSessionApiSchema, VibeSessionListItemApiSchema,
    UpdateVibeSessionApiBodySchema, UpdateSelectionPromptDataApiSchema, GenerateDesignDataApiSchema,
    VibePresetApiSchema, CreatePresetApiBodySchema, VibePresetConfigApiSchema, // Added Preset schemas
    GetBranchesQueryApiSchema, GetBranchesResponseApiSchema, // Added SCM Branches schemas
    GetTreeQueryApiSchema, GetTreeResponseApiSchema, // Added Tree schemas
    GetFileQueryApiSchema, GetFileResponseApiSchema, // Added File schemas
    CommitChangesDataApiSchema, CommitResponseApiSchema, // Added Commit schemas
    UpdateCodeReviewDataApiSchema, // Added Update Code Review schema
    UpdateDesignPromptDataApiSchema, // Added Update Design Prompt schema
} from './schemas/vibe.api.schema';
// User API Schemas
import {
    UserProfileApiResponseSchema,
    UpdateUserProfileApiBodySchema,
} from './schemas/user.api.schema';
// Common API Schemas
import {
    ApiSessionParamsSchema, ApiErrorResponseSchema, ApiMessageResponseSchema,
    ApiNullResponseSchema, ApiPresetParamsSchema, ApiIdParamsSchema,
} from './schemas/common.api.schema';


// Path Parameter Helper (same as before)
type PathParams<TPath extends string> =
    TPath extends `${infer _Start}:${infer Param}/${infer Rest}` ? { [K in Param]: string | number } & PathParams<Rest> :
    TPath extends `${infer _Start}:${infer Param}` ? { [K in Param]: string | number } :
    Record<string, never>;

// Generic Route Definition (same as before)
export interface RouteDefinition<
    TPath extends string, TMethod extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    TPathParamsSchema extends TSchema | undefined = undefined,
    TQuerySchema extends TSchema | undefined = undefined,
    TBodySchema extends TSchema | undefined = undefined,
    TResponseSchemas extends Record<number, TSchema> | TSchema | undefined = undefined
> {
    method: TMethod;
    pathTemplate: TPath;
    buildPath: (params: PathParams<TPath>) => string;
    schemas?: {
        path?: TPathParamsSchema;
        query?: TQuerySchema;
        body?: TBodySchema;
        response?: TResponseSchemas;
    };
}

// Factory Function (same as before)
function defineRoute<
    Path extends string, Method extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    PathParamsSchema extends TSchema | undefined = undefined,
    QuerySchema extends TSchema | undefined = undefined,
    BodySchema extends TSchema | undefined = undefined,
    ResponseSchemas extends Record<number, TSchema> | TSchema | undefined = undefined
>(
    method: Method, pathTemplate: Path,
    config?: { schemas?: RouteDefinition<Path, Method, PathParamsSchema, QuerySchema, BodySchema, ResponseSchemas>['schemas'] }
): RouteDefinition<Path, Method, PathParamsSchema, QuerySchema, BodySchema, ResponseSchemas> {
    // Implementation for buildPath
    const buildPath = (params: PathParams<Path>): string => {
        let builtPath = pathTemplate;
        if (params) {
            for (const key in params) {
                const paramValue = params[key as keyof PathParams<Path>];
                builtPath = builtPath.replace(`:${key}`, String(paramValue));
            }
        }
        return builtPath;
    };

    return {
        method,
        pathTemplate,
        buildPath,
        schemas: config?.schemas,
    };
}

// --- API Definitions Object ---
const VIBE_BASE = '/api/vibe'; // Matches vibeRoutes.ts
const PROFILE_BASE = '/api/profile'; // Matches profile-route.ts

export const API = {
    vibe: {
        // Session CRUD
        create: defineRoute('POST', `${VIBE_BASE}`, {
            schemas: { body: CreateVibeSessionDataApiSchema, response: { 201: VibeSessionApiSchema, 400: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        list: defineRoute('GET', `${VIBE_BASE}`, {
            schemas: { response: { 200: Type.Array(VibeSessionListItemApiSchema), 500: ApiErrorResponseSchema } }
        }),
        getById: defineRoute('GET', `${VIBE_BASE}/:sessionId`, {
            schemas: { path: ApiSessionParamsSchema, response: { 200: VibeSessionApiSchema, 404: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        update: defineRoute('PATCH', `${VIBE_BASE}/:sessionId`, { // Matches PATCH in vibeRoutes.ts
            schemas: { path: ApiSessionParamsSchema, body: UpdateVibeSessionApiBodySchema, response: { 204: ApiNullResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        delete: defineRoute('DELETE', `${VIBE_BASE}/:sessionId`, {
            schemas: { path: ApiSessionParamsSchema, response: { 204: ApiNullResponseSchema, 404: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),

        // Presets
        createPreset: defineRoute('POST', `${VIBE_BASE}/presets`, {
            schemas: { body: CreatePresetApiBodySchema, response: { 201: VibePresetApiSchema, 400: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        listPresets: defineRoute('GET', `${VIBE_BASE}/presets`, {
            schemas: { response: { 200: Type.Array(VibePresetApiSchema), 500: ApiErrorResponseSchema } }
        }),
        deletePreset: defineRoute('DELETE', `${VIBE_BASE}/presets/:presetId`, { // Matches :presetId
            schemas: { path: ApiPresetParamsSchema, response: { 204: ApiNullResponseSchema, 404: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),

        // Workflow Actions
        updateSelectionPrompt: defineRoute('POST', `${VIBE_BASE}/:sessionId/update-selection`, {
            schemas: { path: ApiSessionParamsSchema, body: UpdateSelectionPromptDataApiSchema, response: { 202: ApiMessageResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        generateDesign: defineRoute('POST', `${VIBE_BASE}/:sessionId/generate-design`, {
            schemas: { path: ApiSessionParamsSchema, body: GenerateDesignDataApiSchema, response: { 202: ApiMessageResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        updateDesign: defineRoute('POST', `${VIBE_BASE}/:sessionId/update-design`, { // New from vibeRoutes.ts
            schemas: { path: ApiSessionParamsSchema, body: Type.Object({ design: Type.String() }) /* Assuming simple body */, response: { 202: ApiMessageResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        updateDesignPrompt: defineRoute('POST', `${VIBE_BASE}/:sessionId/update-design-prompt`, { // Renamed from update-design-instructions
            schemas: { path: ApiSessionParamsSchema, body: UpdateDesignPromptDataApiSchema, response: { 202: ApiMessageResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        executeDesign: defineRoute('POST', `${VIBE_BASE}/:sessionId/execute-design`, {
            schemas: { path: ApiSessionParamsSchema, response: { 202: ApiMessageResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } } // No body
        }),
        resetSelection: defineRoute('POST', `${VIBE_BASE}/:sessionId/reset-selection`, {
            schemas: { path: ApiSessionParamsSchema, response: { 202: ApiMessageResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } } // No body
        }),
        updateCode: defineRoute('POST', `${VIBE_BASE}/:sessionId/update-code`, {
            schemas: { path: ApiSessionParamsSchema, body: UpdateCodeReviewDataApiSchema, response: { 202: ApiNullResponseSchema /* vibeRoutes has Null */, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        commitChanges: defineRoute('POST', `${VIBE_BASE}/:sessionId/commit`, {
            schemas: { path: ApiSessionParamsSchema, body: CommitChangesDataApiSchema, response: { 200: CommitResponseApiSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),

        // Helpers
        getRepoBranches: defineRoute('GET', `${VIBE_BASE}/repositories/branches`, { // Matches vibeRoutes.ts
            schemas: { query: GetBranchesQueryApiSchema, response: { 200: GetBranchesResponseApiSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema } }
        }),
        getFileSystemTree: defineRoute('GET', `${VIBE_BASE}/:sessionId/tree`, {
            schemas: { path: ApiSessionParamsSchema, query: GetTreeQueryApiSchema, response: { 200: GetTreeResponseApiSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        getFileContent: defineRoute('GET', `${VIBE_BASE}/:sessionId/file`, {
            schemas: { path: ApiSessionParamsSchema, query: GetFileQueryApiSchema, response: { 200: GetFileResponseApiSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
    },
    profile: {
        view: defineRoute('GET', `${PROFILE_BASE}/view`, {
            schemas: { response: { 200: UserProfileApiResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        update: defineRoute('POST', `${PROFILE_BASE}/update`, {
            schemas: { body: UpdateUserProfileApiBodySchema, response: { 200: UserProfileApiResponseSchema, 400: ApiErrorResponseSchema } }
        }),
    },
    // ... other modules like auth, scm, agent, llms
};
