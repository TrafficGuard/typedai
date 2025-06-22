import type { EditBlock } from '../coderTypes';
import type { ValidationIssue, ValidationRule } from './validationRule';

/**
 * Sometimes the search/replace coder will write a file with the module alias e.g. #shard/common.service.ts instead of src/shard/common.service.ts
 * We want to detect and prevent this.
 */
export class ModuleAliasRule implements ValidationRule {
	readonly name = 'ModuleAliasRule';

	async check(block: EditBlock, _repoFiles: string[]): Promise<ValidationIssue | null> {
		// Make sure we haven't parsed a markdown header (e.g starting with '# ', '## ', '### '). Regex match on #'s then space.
		const pathIsMarkdownHeader = block.filePath.match(/^#\s/);
		if ((block.filePath.startsWith('#') && !pathIsMarkdownHeader) || block.filePath.startsWith('@')) {
			return {
				file: block.filePath,
				reason: `File path "${block.filePath}" should not begin with '${block.filePath.charAt(0)}'. It seems like you're writing to a module alias. You need to write to a real file path.`,
			};
		}
		return null;
	}
}
