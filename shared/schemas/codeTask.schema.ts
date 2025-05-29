import { type Static, Type } from '@sinclair/typebox';
import type {
	CodeTask,
	CodeTaskPreset,
	CodeTaskPresetConfig,
	CodeTaskStatus,
	CommitChangesData,
	CreateCodeTaskData,
	GenerateDesignData,
	UpdateCodeReviewData,
	UpdateCodeTaskData,
	UpdateDesignInstructionsData,
	UpdateDesignPromptData,
	UpdateSelectionPromptData,
} from '#shared/model/codeTask.model';
import type { SelectedFile } from '#shared/model/files.model';
import type { FileSystemNode } from '#shared/services/fileSystemService';
import type { AreTypesFullyCompatible } from '../utils/type-compatibility';

// --- CodeTaskStatus Schema ---
// Assuming CodeTaskStatus is a union of string literals as defined in codeTask.model.ts
const codeTaskStatusLiterals: CodeTaskStatus[] = [
	'initializing',
	'file_selection_review',
	'updating_file_selection',
	'generating_design',
	'design_review',
	'coding',
	'code_review',
	'committing',
	'ci_monitoring',
	'feedback',
	'completed',
	'error',
];
export const CodeTaskStatusApiSchema = Type.Union(
	codeTaskStatusLiterals.map((s) => Type.Literal(s)),
	{ description: 'The current status of the Code task' },
);
const _codeTaskStatusApiCheck: AreTypesFullyCompatible<CodeTaskStatus, Static<typeof CodeTaskStatusApiSchema>> = true;

// --- SelectedFile Schema ---
// Based on the structure in codeTask.model.ts
export const SelectedFileApiSchema = Type.Object({
	filePath: Type.String(),
	reason: Type.Optional(Type.String()),
	readOnly: Type.Optional(Type.Boolean()),
	category: Type.Optional(Type.Union([Type.Literal('edit'), Type.Literal('reference'), Type.Literal('style_example'), Type.Literal('unknown')])),
});
const _selectedFileApiCheck: AreTypesFullyCompatible<SelectedFile, Static<typeof SelectedFileApiSchema>> = true;

// --- CreateCodeTaskData Schema ---
export const CreateCodeTaskDataApiSchema = Type.Object({
	title: Type.String(),
	instructions: Type.String(),
	repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
	repositoryId: Type.Optional(Type.String()),
	repositoryName: Type.Optional(Type.String()),
	targetBranch: Type.String(),
	workingBranch: Type.String(),
	createWorkingBranch: Type.Boolean(),
	useSharedRepos: Type.Boolean(),
	// Note: Does not include fields auto-generated or set by the system (id, userId, status, etc.)
});
const _createCodeTaskDataApiCheck: AreTypesFullyCompatible<CreateCodeTaskData, Static<typeof CreateCodeTaskDataApiSchema>> = true;

// --- CodeTask Schema (Full entity) ---
export const CodeTaskApiSchema = Type.Object({
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
	status: CodeTaskStatusApiSchema,
	lastAgentActivity: Type.Number(), // Assuming timestamp
	fileSelection: Type.Optional(Type.Array(SelectedFileApiSchema)),
	designAnswer: Type.Optional(Type.String()),
	codeDiff: Type.Optional(Type.String()),
	commitSha: Type.Optional(Type.String()),
	pullRequestUrl: Type.Optional(Type.String()),
	ciCdStatus: Type.Optional(
		Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('success'), Type.Literal('failed'), Type.Literal('cancelled')]),
	),
	ciCdJobUrl: Type.Optional(Type.String()),
	ciCdAnalysis: Type.Optional(Type.String()),
	ciCdProposedFix: Type.Optional(Type.String()),
	createdAt: Type.Number(), // Assuming timestamp
	updatedAt: Type.Number(), // Assuming timestamp
	agentHistory: Type.Optional(Type.Array(Type.String())),
	error: Type.Optional(Type.String()),
});
const _codeTaskApiCheck: AreTypesFullyCompatible<CodeTask, Static<typeof CodeTaskApiSchema>> = true;

// --- CodeTaskListItem Schema (for list views) ---
export const CodeTaskListItemKeys = ['id', 'title', 'status', 'createdAt', 'updatedAt', 'repositoryName', 'targetBranch'] as const;
export const CodeTaskListItemApiSchema = Type.Pick(CodeTaskApiSchema, CodeTaskListItemKeys);
type CodeTaskListItemModel = Pick<CodeTask, (typeof CodeTaskListItemKeys)[number]>;
const _codeTaskListItemApiCheck: AreTypesFullyCompatible<CodeTaskListItemModel, Static<typeof CodeTaskListItemApiSchema>> = true;

// --- UpdateCodeTaskData Schema ---
export const UpdateCodeTaskApiBodySchema = Type.Partial(
	Type.Object(
		{
			title: Type.String(),
			instructions: Type.String(),
			repositoryName: Type.Optional(Type.String()),
			useSharedRepos: Type.Boolean(),
			status: CodeTaskStatusApiSchema,
			lastAgentActivity: Type.Number(),
			fileSelection: Type.Optional(Type.Array(SelectedFileApiSchema)),
			designAnswer: Type.Optional(Type.String()),
			codeDiff: Type.Optional(Type.String()),
			commitSha: Type.Optional(Type.String()),
			pullRequestUrl: Type.Optional(Type.String()),
			ciCdStatus: Type.Optional(
				Type.Union([Type.Literal('pending'), Type.Literal('running'), Type.Literal('success'), Type.Literal('failed'), Type.Literal('cancelled')]),
			),
			ciCdJobUrl: Type.Optional(Type.String()),
			ciCdAnalysis: Type.Optional(Type.String()),
			ciCdProposedFix: Type.Optional(Type.String()),
			updatedAt: Type.Number(),
			agentHistory: Type.Optional(Type.Array(Type.String())),
			error: Type.Optional(Type.String()),
			filesToAdd: Type.Optional(Type.Array(Type.String())),
			filesToRemove: Type.Optional(Type.Array(Type.String())),
		},
		{ additionalProperties: false },
	),
);
const _updateCodeTaskDataApiCheck: AreTypesFullyCompatible<UpdateCodeTaskData, Static<typeof UpdateCodeTaskApiBodySchema>> = true;

// --- Action-Specific Schemas from codeTask.model.ts ---
export const UpdateSelectionPromptDataApiSchema = Type.Object({
	prompt: Type.String(),
});
const _updateSelectionPromptDataApiCheck: AreTypesFullyCompatible<UpdateSelectionPromptData, Static<typeof UpdateSelectionPromptDataApiSchema>> = true;

export const GenerateDesignDataApiSchema = Type.Object({
	instructions: Type.String(),
});
const _generateDesignDataApiCheck: AreTypesFullyCompatible<GenerateDesignData, Static<typeof GenerateDesignDataApiSchema>> = true;

export const UpdateDesignPromptDataApiSchema = Type.Object({
	prompt: Type.String(),
});
const _updateDesignPromptDataApiCheck: AreTypesFullyCompatible<UpdateDesignPromptData, Static<typeof UpdateDesignPromptDataApiSchema>> = true;

export const UpdateDesignInstructionsDataApiSchema = Type.Object({
	instructions: Type.String(),
});
const _updateDesignInstructionsDataApiCheck: AreTypesFullyCompatible<UpdateDesignInstructionsData, Static<typeof UpdateDesignInstructionsDataApiSchema>> = true;

export const CommitChangesDataApiSchema = Type.Object({
	commitTitle: Type.String(),
	commitMessage: Type.String(),
});
const _commitChangesDataApiCheck: AreTypesFullyCompatible<CommitChangesData, Static<typeof CommitChangesDataApiSchema>> = true;

export const UpdateCodeReviewDataApiSchema = Type.Object({
	reviewComments: Type.String(),
});
const _updateCodeReviewDataApiCheck: AreTypesFullyCompatible<UpdateCodeReviewData, Static<typeof UpdateCodeReviewDataApiSchema>> = true;

// --- CodeTaskPreset Schemas ---
export const CodeTaskPresetConfigApiSchema = Type.Object({
	repositorySource: Type.Union([Type.Literal('local'), Type.Literal('github'), Type.Literal('gitlab')]),
	repositoryId: Type.Optional(Type.String()),
	repositoryName: Type.Optional(Type.String()), // MODIFIED
	targetBranch: Type.String(),
	workingBranch: Type.String(),
	createWorkingBranch: Type.Boolean(),
	useSharedRepos: Type.Boolean(),
	// Ensure this matches Omit<CreateCodeTaskData, 'title' | 'instructions'>
});
const _codeTaskPresetConfigApiCheck: AreTypesFullyCompatible<CodeTaskPresetConfig, Static<typeof CodeTaskPresetConfigApiSchema>> = true;

export const CodeTaskPresetApiSchema = Type.Object({
	id: Type.String(),
	userId: Type.String(),
	name: Type.String(),
	config: CodeTaskPresetConfigApiSchema,
	createdAt: Type.Number(),
	updatedAt: Type.Number(),
});
const _codeTaskPresetApiCheck: AreTypesFullyCompatible<CodeTaskPreset, Static<typeof CodeTaskPresetApiSchema>> = true;

export const CreatePresetApiBodySchema = Type.Object({
	name: Type.String(),
	config: CodeTaskPresetConfigApiSchema,
});
type CreatePresetModel = Pick<CodeTaskPreset, 'name' | 'config'>;
const _createPresetApiCheck: AreTypesFullyCompatible<CreatePresetModel, Static<typeof CreatePresetApiBodySchema>> = true;

// --- Schemas for File System Operations (from codeTaskRoutes.ts) ---
export const GetBranchesQueryApiSchema = Type.Object({
	providerType: Type.String({ description: "The type of SCM provider, e.g., 'local', 'gitlab', or 'github'" }),
	projectId: Type.String({ description: 'The project identifier (repository path for local, project ID/path for remote)' }),
});
export const GetBranchesResponseApiSchema = Type.Array(Type.String());

export const FileSystemNodeApiSchema = Type.Recursive((Self) =>
	Type.Object({
		path: Type.String(), // Added path
		name: Type.String(),
		type: Type.Union([Type.Literal('file'), Type.Literal('directory')]),
		children: Type.Optional(Type.Array(Self)),
		summary: Type.Optional(Type.String()), // Added summary
	}),
);
const _fileSystemNodeApiCheck: AreTypesFullyCompatible<FileSystemNode, Static<typeof FileSystemNodeApiSchema>> = true;

export const GetTreeQueryApiSchema = Type.Object({
	path: Type.Optional(Type.String()),
});
export const GetTreeResponseApiSchema = FileSystemNodeApiSchema; // The old codeTaskRoutes returned a single root node, not an array. Let's match that.
// If it should be an array of root nodes: Type.Array(FileSystemNodeApiSchema)

export const GetFileQueryApiSchema = Type.Object({
	path: Type.String(),
});
export const GetFileResponseApiSchema = Type.Object({
	content: Type.String(),
});

// Schema for Commit Response (from codeTaskRoutes.ts)
export const CommitResponseApiSchema = Type.Object({
	commitSha: Type.Optional(Type.String()),
	pullRequestUrl: Type.Optional(Type.String()), // Changed prUrl to pullRequestUrl
});
type CommitResponseModel = { commitSha?: string; pullRequestUrl?: string };
const _commitResponseApiCheck: AreTypesFullyCompatible<CommitResponseModel, Static<typeof CommitResponseApiSchema>> = true;
