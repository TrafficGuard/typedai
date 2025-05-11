/**
 * State of a vibe coding session
 * This must match the server API VibeSession at src/vibe/vibe.model.ts
 */
export interface VibeSession {
	id: string;
	title: string;
	status:
		| 'initializing'
		| 'file_selection_review'
		| 'updating_file_selection'
		| 'generating_design'
		| 'design_review'
		| 'updating_design'
		| 'coding'
		| 'code_review'
		| 'committing'
		| 'monitoring_ci'
		| 'ci_failed'
		| 'completed'
		| 'error_file_selection'
		| 'error_design_generation'
		| 'error_coding'
		| 'error';
	instructions: string;
	repositorySource: 'local' | 'github' | 'gitlab';
	repositoryId: string;
	repositoryName?: string | null;
	branch: string;
	newBranchName?: string | null;
	useSharedRepos: boolean;
	fileSelection?: SelectedFile[];
	designAnswer?: string; // Note: Backend uses DesignAnswer interface, frontend might simplify or need full type
	// selectedVariations?: number; // Removed - This was added in backend but might not be needed here yet
	createdAt: number;
	updatedAt: number;
	error?: string;
	// Add other fields from backend VibeSession if needed by frontend (e.g., codeDiff, commitSha, etc.)
}

// Define SelectedFile type locally for the frontend
export interface SelectedFile {
	filePath: string; // Keep existing name 'filePath' for frontend consistency
	readOnly?: boolean;
	reason?: string; // Optional reason if needed
	category?: 'edit' | 'reference' | 'style_example' | 'unknown';
}

/**
 * Represents a node in the file system tree.
 * Must match FileSystemNodeSchema in src/routes/vibe/vibeRoutes.ts
 */
export interface FileSystemNode {
	path: string; // Add path property
	name: string;
	type: 'file' | 'directory';
	children?: FileSystemNode[]; // Optional for directories
}

/**
 * Data structure for creating a new Vibe session (mirrors relevant backend fields).
 * Used for defining VibePreset config.
 */
export interface CreateVibeSessionData {
	// Note: title and instructions are omitted in VibePreset config
	repositorySource: 'local' | 'github' | 'gitlab';
	repositoryId: string;
	repositoryName?: string | null;
	targetBranch: string; // Renamed from 'branch' in VibeSession for clarity during creation/preset
	workingBranch: string; // Renamed from 'newBranchName' in VibeSession for clarity
	createWorkingBranch: boolean;
	useSharedRepos: boolean;
}

/**
 * Common interface between projects in GitLab, GitHub etc
 * Must match GitProject in src/functions/scm/gitProject.ts
 */
export interface GitProject {
	/** The type of SCM provider, e.g., 'github', 'gitlab' */
	type: string;
	/** The hostname of the SCM provider, e.g., 'github.com', 'gitlab.com' */
	host: string;
	id: number;
	/** The project name */
	name: string;
	/** Group/organisation/user */
	namespace: string;
	/** The full path of the project with the namespace and name */
	fullPath: string;
	description: string | null;
	defaultBranch: string;
	visibility: string;
	archived: boolean;
	extra?: Record<string, any>;
}

/**
 * Represents a saved Vibe session configuration preset.
 * Must match VibePreset in src/vibe/vibe.model.ts
 */
export interface VibePreset {
	id: string;
	userId: string; // Assuming userId is relevant on the frontend, matches backend
	name: string;
	config: Omit<CreateVibeSessionData, 'title' | 'instructions'>;
	createdAt: any; // Use 'any' or appropriate frontend timestamp type
	updatedAt: any; // Use 'any' or appropriate frontend timestamp type
}

/** Configuration part of a Vibe Preset (derived from CreateVibeSessionData) */
export type VibePresetConfig = Omit<CreateVibeSessionData, 'title' | 'instructions'>;
