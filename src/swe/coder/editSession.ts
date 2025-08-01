import { v4 as uuidv4 } from 'uuid';
import type { EditBlock } from './coderTypes'; // Assuming EditBlock is still in applySearchReplace

export interface RequestedFileEntry {
	filePath: string;
	reason: string;
}

export interface RequestedQueryEntry {
	query: string;
	reason?: string; // Optional: if LLM provides a reason for the query
}

export interface RequestedPackageInstallEntry {
	packageName: string;
	reason: string;
}

export interface EditSession {
	id: string; // uuid()
	workingDir: string;
	attempt: number;
	// input & result
	llmRequest: string;
	llmResponse?: string;
	parsedBlocks?: EditBlock[];
	validatedBlocks?: EditBlock[];
	appliedFiles?: Set<string>; // Relative paths of successfully edited files
	reflectionMessages: string[];
	requestedFiles?: RequestedFileEntry[]; // To store parsed file requests from LLM
	requestedQueries?: RequestedQueryEntry[]; // New: To store parsed query requests
	requestedPackageInstalls?: RequestedPackageInstallEntry[]; // New: To store parsed package install requests
	// state snapshots
	absFnamesInChat?: Set<string>; // Absolute paths of files explicitly in chat
	initiallyDirtyFiles?: Set<string>; // Relative paths of files that were dirty when we started
}

export function newSession(workingDir: string, llmRequest: string): EditSession {
	return {
		id: uuidv4(),
		workingDir,
		attempt: 0,
		llmRequest,
		reflectionMessages: [],
		absFnamesInChat: new Set(),
		initiallyDirtyFiles: new Set(),
		requestedFiles: undefined,
		requestedQueries: undefined, // Initialize as undefined
		requestedPackageInstalls: undefined, // Initialize as undefined
	};
}
