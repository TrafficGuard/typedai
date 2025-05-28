import type { EditBlock } from '../applySearchReplace';
import type { ValidationIssue, ValidationRule } from './ValidationRule';

export class PathExistsRule implements ValidationRule {
	readonly name = 'PathExistsRule';

	check(block: EditBlock, repoFiles: string[]): ValidationIssue | null {
		const fileExists = repoFiles.includes(block.filePath);

		if (!fileExists && block.originalText.trim() !== '') {
			return {
				file: block.filePath,
				reason: 'File does not exist, but the SEARCH block is not empty. To create a new file, the SEARCH block must be empty.',
			};
		}
		return null;
	}
}
