import type { EditBlock } from '../coderTypes';
import type { ValidationIssue, ValidationRule } from './validationRule';

export interface ValidateBlocksResult {
	valid: EditBlock[];
	issues: ValidationIssue[];
}

/**
 * Validates a list of edit blocks against a set of validation rules.
 * @param blocks The edit blocks to validate.
 * @param repoFiles A list of all file paths in the repository.
 * @param rules An array of validation rules to apply.
 * @returns An object containing arrays of valid blocks and any validation issues found.
 */
export function validateBlocks(blocks: EditBlock[], repoFiles: string[], rules: ValidationRule[]): ValidateBlocksResult {
	const valid: EditBlock[] = [];
	const issues: ValidationIssue[] = [];
	const blockIssuesCache = new Map<EditBlock, ValidationIssue[]>();

	for (const block of blocks) {
		let blockIsValid = true;
		const currentBlockIssues: ValidationIssue[] = [];

		for (const rule of rules) {
			const issue = rule.check(block, repoFiles);
			if (issue) {
				currentBlockIssues.push(issue);
				blockIsValid = false;
				// Do not break here, collect all issues for this block from all rules
			}
		}

		if (blockIsValid) {
			valid.push(block);
		} else {
			issues.push(...currentBlockIssues);
			// Optionally, store per-block issues if needed later, though current return aggregates all issues.
			// blockIssuesCache.set(block, currentBlockIssues);
		}
	}

	// If a block has any issue, it's not in `valid`. `issues` contains all found issues.
	// If a block is invalid, it should not be processed. The current logic correctly excludes them from `valid`.
	// The requirement is to return {valid: EditBlock[], issues: ValidationIssue[]}
	// where `issues` are for the blocks that were *not* valid.

	return { valid, issues };
}
