import type { EditBlock } from '../applySearchReplace';
import type { ValidationRule, ValidationIssue } from './ValidationRule';

export class ModuleAliasRule implements ValidationRule {
	readonly name = 'ModuleAliasRule';

	check(block: EditBlock, repoFiles: string[]): ValidationIssue | null {
		if (block.filePath.startsWith('#') || block.filePath.startsWith('@')) {
			return {
				file: block.filePath,
				reason: `File path "${block.filePath}" should not begin with '${block.filePath.charAt(0)}'. It seems like you're writing to a module alias. You need to write to a real file path.`,
			};
		}
		return null;
	}
}
