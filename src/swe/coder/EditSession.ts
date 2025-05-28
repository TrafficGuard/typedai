import { v4 as uuidv4 } from 'uuid';
import type { EditBlock } from './applySearchReplace'; // Assuming EditBlock is still in applySearchReplace

export interface EditSession {
	id: string; // uuid()
	workingDir: string;
	attempt: number;
	// input & result
	llmRequest: string;
	llmResponse?: string;
	parsedBlocks?: EditBlock[];
	validatedBlocks?: EditBlock[];
	appliedFiles?: Set<string>;
	reflectionMessages: string[];
	// state snapshots
	dirtyBefore: string[]; // Relative paths
	editedButUncommitted: string[]; // Relative paths
}

export function newSession(workingDir: string, llmRequest: string): EditSession {
	return {
		id: uuidv4(),
		workingDir,
		attempt: 0,
		llmRequest,
		reflectionMessages: [],
		dirtyBefore: [],
		editedButUncommitted: [],
	};
}
