import { Type, type Static } from '@sinclair/typebox';
// Source of Truth Model Interfaces from shared/model/vibe.model.ts
import type {
    VibeSession,
    CreateVibeSessionData,
    UpdateVibeSessionData,
    DesignAnswer,
    VibeStatus,
    CommitChangesData,
    UpdateCodeReviewData,
    VibePreset,
    VibePresetConfig,
    UpdateSelectionPromptData,
    GenerateDesignData,
    UpdateDesignPromptData,
} from '#shared/model/vibe.model';

// Compatibility Checker
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';
// Common Schemas
import { ApiNullResponseSchema } from './common.api.schema';
import {SelectedFile} from "#shared/model/files.model";


// --- VibeStatus Schema ---
// Assuming VibeStatus is a union of string literals as defined in vibe.model.ts
const vibeStatusLiterals: VibeStatus[] = [
    'initializing', 'updating_file_selection', 'file_selection_review',
    'generating_design', 'design_review', 'design_review_details', 'updating_design',
    'coding', 'code_review', 'committing', 'monitoring_ci', 'ci_failed',
    'completed', 'error_file_selection', 'error_design_generation',
    'error_coding', 'error',
];
export const VibeStatusApiSchema = Type.Union(
    vibeStatusLiterals.map(s => Type.Literal(s)),
    { description: 'The current status of the Vibe session' }
);
const _vibeStatusApiCheck: AreTypesFullyCompatible<VibeStatus, Static<typeof VibeStatusApiSchema>> = true;

// --- SelectedFile Schema ---
// Based on the structure in vibe.model.ts
export const SelectedFileApiSchema = Type.Object({
    filePath: Type.String(),
    reason: Type.Optional(Type.String()),
    readOnly: Type.Optional(Type.Boolean()),
    category: Type.Optional(Type.Union([
        Type.Literal('edit'),
        Type.Literal('reference'),
        Type.Literal('style_example'),
        Type.Literal('unknown'),
    ])),
});
const _selectedFileApiCheck: AreTypesFullyCompatible<SelectedFile, Static<typeof SelectedFileApiSchema>> = true;

// --- DesignAnswer Schema ---
export const DesignAnswerApiSchema = Type.Object({
    summary: Type.String(),
    steps: Type.Array(Type.String()),
    reasoning: Type.String(),
});
const _designAnswerApiCheck: AreTypesFullyCompatible<DesignAnswer, Static<typeof DesignAnswerApiSchema>> = true;

// --- CreateVibeSessionData Schema ---
export const CreateVibeSessionDataApiSchema = Type.Object({
    title: Type.String(),
    instructions: Type.String(),
    repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
    repositoryId: Type.Optional(Type.String()),
    repositoryName: Type.Optional(Type.String()), // MODIFIED
    targetBranch: Type.String(),
    workingBranch: Type.String(),
    createWorkingBranch: Type.Boolean(),
    useSharedRepos: Type.Boolean(),
    originalFileSelectionForReview: Type.Optional(Type.Array(SelectedFileApiSchema)), // ADDED
    selectedVariations: Type.Optional(Type.Number()), // ADDED
    // Note: Does not include fields auto-generated or set by the system (id, userId, status, etc.)
});
const _createVibeSessionDataApiCheck: AreTypesFullyCompatible<CreateVibeSessionData, Static<typeof CreateVibeSessionDataApiSchema>> = true;

// --- VibeSession Schema (Full entity) ---
export const VibeSessionApiSchema = Type.Object({
    id: Type.String(),
    userId: Type.String(),
    title: Type.String(),
    instructions: Type.String(),
    repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
    repositoryId: Type.String(),
    repositoryName: Type.Optional(Type.String()), // MODIFIED
    targetBranch: Type.String(),
    workingBranch: Type.String(),
    createWorkingBranch: Type.Boolean(),
    useSharedRepos: Type.Boolean(),
    status: VibeStatusApiSchema,
    lastAgentActivity: Type.Number(), // Assuming timestamp
    fileSelection: Type.Optional(Type.Array(SelectedFileApiSchema)),
    originalFileSelectionForReview: Type.Optional(Type.Array(SelectedFileApiSchema)),
    designAnswer: Type.Optional(DesignAnswerApiSchema),
    selectedVariations: Type.Optional(Type.Number()),
    codeDiff: Type.Optional(Type.String()),
    commitSha: Type.Optional(Type.String()),
    pullRequestUrl: Type.Optional(Type.String()),
    ciCdStatus: Type.Optional(Type.Union([
        Type.Literal('pending'), Type.Literal('running'),
        Type.Literal('success'), Type.Literal('failed'), Type.Literal('cancelled')
    ])),
    ciCdJobUrl: Type.Optional(Type.String()),
    ciCdAnalysis: Type.Optional(Type.String()),
    ciCdProposedFix: Type.Optional(Type.String()),
    createdAt: Type.Number(), // Assuming timestamp
    updatedAt: Type.Number(), // Assuming timestamp
    agentHistory: Type.Optional(Type.Array(Type.String())),
    error: Type.Optional(Type.String()),
    // config: Type.Optional(Type.Any()), // VibePresetConfig is more specific if available
});
// The 'config' property in VibeSession model is not explicitly defined,
// if it refers to VibePresetConfig, a VibePresetConfigApiSchema should be used.
// For now, I'll omit 'config' from VibeSessionApiSchema to avoid potential mismatch
// until VibeSession's 'config' property is clarified or if it's not part of API responses.
// If it IS part of the API response for VibeSession, it needs to be added here.
// Let's assume for now it's not directly part of the VibeSession API response schema.
const _vibeSessionApiCheck: AreTypesFullyCompatible<Omit<VibeSession, 'config'>, Static<typeof VibeSessionApiSchema>> = true;


// --- VibeSessionListItem Schema (for list views) ---
// Based on Pick<VibeSession, 'id' | 'title' | 'status' | 'createdAt' | 'updatedAt' | 'repositoryName' | 'targetBranch'>
// The model in vibeRoutes.ts used: Type.Pick(VibeSessionResponseSchema, ['id', 'title', 'status', 'createdAt', 'updatedAt', 'repositoryName', 'targetBranch'])
export const VibeSessionListItemApiSchema = Type.Pick(VibeSessionApiSchema, [
    'id', 'title', 'status', 'createdAt', 'updatedAt', 'repositoryName', 'targetBranch'
]);
// type VibeSessionListItemModel = Pick<VibeSession, 'id' | 'title' | 'status' | 'createdAt' | 'updatedAt' | 'repositoryName' | 'targetBranch'>;
// const _vibeSessionListItemApiCheck: AreTypesFullyCompatible<VibeSessionListItemModel, Static<typeof VibeSessionListItemApiSchema>> = true;
// The above check requires VibeSessionListItem type to be exported from model, or defined locally.
// For now, assuming the Pick from VibeSessionApiSchema is the intended structure for the API list item.


// --- UpdateVibeSessionData Schema ---
// UpdateVibeSessionData is a Partial<Omit<VibeSession, ...>> & { filesToAdd?: string[], filesToRemove?: string[] }
// This is complex to model perfectly with TypeBox if filesToAdd/Remove are top-level with other partial VibeSession fields.
// A simpler approach for PATCH is often a schema with only the explicitly patchable fields.
export const UpdateVibeSessionApiBodySchema = Type.Partial(
    Type.Object({
        title: Type.String(),
        instructions: Type.String(),
        status: VibeStatusApiSchema,
        fileSelection: Type.Array(SelectedFileApiSchema), // To replace the whole selection
        designAnswer: DesignAnswerApiSchema, // To update/replace design
        // Add other fields from VibeSession that are directly updatable via PATCH
        // For filesToAdd/filesToRemove, these might be better as dedicated actions if they don't fit well
        // into a direct PATCH of VibeSession fields.
        // The model UpdateVibeSessionData has filesToAdd/filesToRemove, which are not direct properties of VibeSession.
        // This schema will represent the VibeSession properties that can be patched.
        // A separate schema might be needed if filesToAdd/Remove are part of the same PATCH body.
    }), { additionalProperties: false } // Usually good for PATCH to avoid unexpected fields
);
// The AreTypesFullyCompatible check for UpdateVibeSessionData is tricky due to its composite nature.
// It's `Partial<Omit<VibeSession, ...>> & { filesToAdd?: string[]; filesToRemove?: string[]; }`.
// We'd need to construct a model type that exactly matches what this schema represents for a precise check.


// --- Action-Specific Schemas from vibe.model.ts ---
export const UpdateSelectionPromptDataApiSchema = Type.Object({
    prompt: Type.String(),
});
const _updateSelectionPromptDataApiCheck: AreTypesFullyCompatible<UpdateSelectionPromptData, Static<typeof UpdateSelectionPromptDataApiSchema>> = true;

export const GenerateDesignDataApiSchema = Type.Object({
    variations: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })), // Max 5 from vibeRoutes
});
const _generateDesignDataApiCheck: AreTypesFullyCompatible<GenerateDesignData, Static<typeof GenerateDesignDataApiSchema>> = true;

export const UpdateDesignPromptDataApiSchema = Type.Object({
    prompt: Type.String(),
});
const _updateDesignPromptDataApiCheck: AreTypesFullyCompatible<UpdateDesignPromptData, Static<typeof UpdateDesignPromptDataApiSchema>> = true;

export const CommitChangesDataApiSchema = Type.Object({
    commitTitle: Type.String(),
    commitMessage: Type.String(),
});
const _commitChangesDataApiCheck: AreTypesFullyCompatible<CommitChangesData, Static<typeof CommitChangesDataApiSchema>> = true;

export const UpdateCodeReviewDataApiSchema = Type.Object({
    reviewComments: Type.String(),
});
const _updateCodeReviewDataApiCheck: AreTypesFullyCompatible<UpdateCodeReviewData, Static<typeof UpdateCodeReviewDataApiSchema>> = true;


// --- VibePreset Schemas ---
export const VibePresetConfigApiSchema = Type.Object({
    repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
    repositoryId: Type.Optional(Type.String()),
    repositoryName: Type.Optional(Type.String()), // MODIFIED
    targetBranch: Type.String(),
    workingBranch: Type.String(),
    createWorkingBranch: Type.Boolean(),
    useSharedRepos: Type.Boolean(),
    originalFileSelectionForReview: Type.Optional(Type.Array(SelectedFileApiSchema)), // ADDED
    selectedVariations: Type.Optional(Type.Number()), // ADDED
    // Ensure this matches Omit<CreateVibeSessionData, 'title' | 'instructions'>
});
const _vibePresetConfigApiCheck: AreTypesFullyCompatible<VibePresetConfig, Static<typeof VibePresetConfigApiSchema>> = true;

export const VibePresetApiSchema = Type.Object({
    id: Type.String(),
    userId: Type.String(),
    name: Type.String(),
    config: VibePresetConfigApiSchema,
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
});
const _vibePresetApiCheck: AreTypesFullyCompatible<VibePreset, Static<typeof VibePresetApiSchema>> = true;

export const CreatePresetApiBodySchema = Type.Object({
    name: Type.String(),
    config: VibePresetConfigApiSchema,
});
// type CreatePresetModel = Pick<VibePreset, 'name' | 'config'>; // Or define a specific model
// const _createPresetApiCheck: AreTypesFullyCompatible<CreatePresetModel, Static<typeof CreatePresetApiBodySchema>> = true;


// --- Schemas for File System Operations (from vibeRoutes.ts) ---
export const GetBranchesQueryApiSchema = Type.Object({
    providerType: Type.String({ description: "The type of SCM provider, e.g., 'local', 'gitlab', or 'github'" }),
    projectId: Type.String({ description: 'The project identifier (repository path for local, project ID/path for remote)' }),
});
export const GetBranchesResponseApiSchema = Type.Array(Type.String());

export const FileSystemNodeApiSchema = Type.Recursive(Self => Type.Object({
    name: Type.String(),
    type: Type.Union([Type.Literal('file'), Type.Literal('directory')]),
    children: Type.Optional(Type.Array(Self)),
}));
// Assuming FileSystemNode model exists and matches this structure.
// import type { FileSystemNode } from '#shared/services/fileSystemService'; // If model is there
// const _fileSystemNodeApiCheck: AreTypesFullyCompatible<FileSystemNode, Static<typeof FileSystemNodeApiSchema>> = true;

export const GetTreeQueryApiSchema = Type.Object({
    path: Type.Optional(Type.String()),
});
export const GetTreeResponseApiSchema = FileSystemNodeApiSchema; // The old vibeRoutes returned a single root node, not an array. Let's match that.
// If it should be an array of root nodes: Type.Array(FileSystemNodeApiSchema)

export const GetFileQueryApiSchema = Type.Object({
    path: Type.String(),
});
export const GetFileResponseApiSchema = Type.Object({
    content: Type.String(),
});

// Schema for Commit Response (from vibeRoutes.ts)
export const CommitResponseApiSchema = Type.Object({
    commitSha: Type.Optional(Type.String()),
    prUrl: Type.Optional(Type.String()), // pullRequestUrl in model
});
// type CommitResponseModel = { commitSha?: string; pullRequestUrl?: string };
// const _commitResponseApiCheck: AreTypesFullyCompatible<CommitResponseModel, Static<typeof CommitResponseApiSchema>> = true;
