import type { EditBlock } from '../coderTypes'; // Assuming EditBlock is still in applySearchReplace

export interface ValidationIssue {
	file: string;
	reason: string;
}

export interface ValidationRule {
	name: string;
	check(block: EditBlock, repoFiles: string[]): Promise<ValidationIssue | null>;
}
