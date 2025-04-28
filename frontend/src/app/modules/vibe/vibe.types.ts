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

// Keep the old Vibe type if it's used elsewhere, otherwise remove it.
// export interface Vibe { }
