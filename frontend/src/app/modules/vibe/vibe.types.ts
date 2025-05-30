/**
 * State of a vibe coding session
 */
export interface VibeSession {
	id: string;
	title: string;
	status: 'initializing' | 'design' | 'coding' | 'review' | 'completed' | 'error'; // Match backend statuses
	instructions: string;
	repositorySource: 'local' | 'github' | 'gitlab';
	repositoryId: string;
	repositoryName?: string | null;
	branch: string;
	newBranchName?: string | null;
	useSharedRepos: boolean;
	fileSelection?: SelectedFile[];
	designAnswer?: string;
	createdAt: any; // Use 'any' or 'string' or 'Date' depending on how Firestore Timestamps are serialized/received
	updatedAt: any;
	error?: string;
}

// Define SelectedFile type locally for the frontend
export interface SelectedFile {
	filePath: string;
	readOnly?: boolean;
	reason?: string; // Optional reason if needed
}

/**
 * Represents a node in the file system tree.
 * Must match FileSystemNodeSchema in src/routes/vibe/vibeRoutes.ts
 */
export interface FileSystemNode {
	name: string;
	type: 'file' | 'directory';
	children?: FileSystemNode[]; // Optional for directories
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
