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
    TResponseSchema extends TSchema | undefined = undefined
    //,TResponseSchemas extends Record<number, TSchema> | TSchema | undefined = undefined
> {
    method: TMethod;
    pathTemplate: TPath;
    buildPath: (params: PathParams<TPath>) => string;
    schema?: {
        path?: TPathParamsSchema;
        querystring?: TQuerySchema;
        body?: TBodySchema;
        response?: TResponseSchema;
        //responses?: TResponseSchemas;
    };
}

// Factory Function (same as before)
export function defineRoute<
    Path extends string, Method extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    PathParamsSchema extends TSchema | undefined = undefined,
    QuerySchema extends TSchema | undefined = undefined,
    BodySchema extends TSchema | undefined = undefined,
    ResponseSchema extends TSchema | undefined = undefined,
    ResponseSchemas extends Record<number, TSchema> | TSchema | undefined = undefined
>(
    method: Method, pathTemplate: Path,
    config?: { schema?: RouteDefinition<Path, Method, PathParamsSchema, QuerySchema, BodySchema, ResponseSchema>['schema'] }//, ResponseSchemas
): RouteDefinition<Path, Method, PathParamsSchema, QuerySchema, BodySchema, ResponseSchema> {//, ResponseSchemas
    // Implementation for buildPath
    const buildPath = (params: PathParams<Path>): string => { // MODIFIED: Explicitly returns string
        let resultPath: string = pathTemplate; // MODIFIED: resultPath is explicitly string
        if (params) {
            // Iterate over the keys of params, which are known to be strings
            for (const key in params) {
                // It's good practice to check if the key is actually a property of the object
                if (Object.prototype.hasOwnProperty.call(params, key)) {
                    // Cast params to any to access key dynamically, or use a more specific type for params if possible
                    const paramValue = (params as any)[key];
                    // The replace operation is safe here as we are replacing parts of a string literal template
                    resultPath = resultPath.replace(`:${key}`, String(paramValue));
                }
            }
        }
        return resultPath;
    };

    return {
        method,
        pathTemplate,
        buildPath,
        schema: config?.schema,
    };
}

// --- API Definitions Object ---
const VIBE_BASE = '/api/vibe'; // Matches vibeRoutes.ts
const PROFILE_BASE = '/api/profile'; // Matches profile-route.ts

export const API = {
    profile: {
        view: defineRoute('GET', `${PROFILE_BASE}/view`, {
            schema: { response: UserProfileApiResponseSchema } // , responses: { 200: UserProfileApiResponseSchema, 500: ApiErrorResponseSchema }
        }),
        update: defineRoute('POST', `${PROFILE_BASE}/update`, {
            schema: { body: UpdateUserProfileApiBodySchema, response: UserProfileApiResponseSchema} // , responses: { 200: UserProfileApiResponseSchema, 400: ApiErrorResponseSchema }
        }),
    },
    /*
    vibe: {
        // Session CRUD
        create: defineRoute('POST', `${VIBE_BASE}`, {
            schema: { body: CreateVibeSessionDataApiSchema, responses: { 201: VibeSessionApiSchema, 400: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        list: defineRoute('GET', `${VIBE_BASE}`, {
            schema: { responses: { 200: Type.Array(VibeSessionListItemApiSchema), 500: ApiErrorResponseSchema } }
        }),
        getById: defineRoute('GET', `${VIBE_BASE}/:sessionId`, {
            schema: { path: ApiSessionParamsSchema, responses: { 200: VibeSessionApiSchema, 404: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        update: defineRoute('PATCH', `${VIBE_BASE}/:sessionId`, { // Matches PATCH in vibeRoutes.ts
            schema: { path: ApiSessionParamsSchema, body: UpdateVibeSessionApiBodySchema, responses: { 204: ApiNullResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        delete: defineRoute('DELETE', `${VIBE_BASE}/:sessionId`, {
            schema: { path: ApiSessionParamsSchema, responses: { 204: ApiNullResponseSchema, 404: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),

        // Presets
        createPreset: defineRoute('POST', `${VIBE_BASE}/presets`, {
            schema: { body: CreatePresetApiBodySchema, responses: { 201: VibePresetApiSchema, 400: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),
        listPresets: defineRoute('GET', `${VIBE_BASE}/presets`, {
            schema: { responses: { 200: Type.Array(VibePresetApiSchema), 500: ApiErrorResponseSchema } }
        }),
        deletePreset: defineRoute('DELETE', `${VIBE_BASE}/presets/:presetId`, { // Matches :presetId
            schema: { path: ApiPresetParamsSchema, responses: { 204: ApiNullResponseSchema, 404: ApiErrorResponseSchema, 500: ApiErrorResponseSchema } }
        }),

        // Workflow Actions
        updateSelectionPrompt: defineRoute('POST', `${VIBE_BASE}/:sessionId/update-selection`, {
            schema: { path: ApiSessionParamsSchema, body: UpdateSelectionPromptDataApiSchema, responses: { 202: ApiMessageResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        generateDesign: defineRoute('POST', `${VIBE_BASE}/:sessionId/generate-design`, {
            schema: { path: ApiSessionParamsSchema, body: GenerateDesignDataApiSchema, responses: { 202: ApiMessageResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        updateDesign: defineRoute('POST', `${VIBE_BASE}/:sessionId/update-design`, { // New from vibeRoutes.ts
        // Assuming simple body

            schema: { path: ApiSessionParamsSchema, body: Type.Object({ design: Type.String() }) , responses: { 202: ApiMessageResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        updateDesignPrompt: defineRoute('POST', `${VIBE_BASE}/:sessionId/update-design-prompt`, { // Renamed from update-design-instructions
            schema: { path: ApiSessionParamsSchema, body: UpdateDesignPromptDataApiSchema, responses: { 202: ApiMessageResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        executeDesign: defineRoute('POST', `${VIBE_BASE}/:sessionId/execute-design`, {
            schema: { path: ApiSessionParamsSchema, responses: { 202: ApiMessageResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } } // No body
        }),
        resetSelection: defineRoute('POST', `${VIBE_BASE}/:sessionId/reset-selection`, {
            schema: { path: ApiSessionParamsSchema, responses: { 202: ApiMessageResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } } // No body
        }),
        updateCode: defineRoute('POST', `${VIBE_BASE}/:sessionId/update-code`, {
            // vibeRoutes has Null
            schema: { path: ApiSessionParamsSchema, body: UpdateCodeReviewDataApiSchema, responses: { 202: ApiNullResponseSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        commitChanges: defineRoute('POST', `${VIBE_BASE}/:sessionId/commit`, {
            schema: { path: ApiSessionParamsSchema, body: CommitChangesDataApiSchema, responses: { 200: CommitResponseApiSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),

        // Helpers
        getRepoBranches: defineRoute('GET', `${VIBE_BASE}/:sessionId/branches`, {
            schema: { path: ApiSessionParamsSchema, querystring: GetBranchesQueryApiSchema, responses: { 200: GetBranchesResponseApiSchema, 400: ApiErrorResponseSchema, 404: ApiErrorResponseSchema } }
        }),
        getFileSystemTree: defineRoute('GET', `${VIBE_BASE}/:sessionId/tree`, {
            schema: { path: ApiSessionParamsSchema, querystring: GetTreeQueryApiSchema, responses: { 200: GetTreeResponseApiSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
        getFileContent: defineRoute('GET', `${VIBE_BASE}/:sessionId/file`, {
            schema: { path: ApiSessionParamsSchema, querystring: GetFileQueryApiSchema, responses: { 200: GetFileResponseApiSchema, 404: ApiErrorResponseSchema, 409: ApiErrorResponseSchema } }
        }),
    },
*/

    // ... other modules like auth, scm, agent, llms
};
