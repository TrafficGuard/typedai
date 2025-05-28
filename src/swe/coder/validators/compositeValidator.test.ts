import { expect } from 'chai';
import { validateBlocks } from './compositeValidator';
import type { EditBlock } from '../applySearchReplace';
import type { ValidationRule, ValidationIssue } from './ValidationRule';
import { PathExistsRule } from './PathExistsRule';
import { ModuleAliasRule } from './ModuleAliasRule';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('validateBlocks', () => {
	setupConditionalLoggerOutput();

	const createEditBlock = (filePath: string, originalText = '', updatedText = 'updated'): EditBlock => ({
		filePath,
		originalText,
		updatedText,
	});

	// Mock rules
	const ruleAlwaysPass: ValidationRule = {
		name: 'AlwaysPass',
		check: () => null,
	};

	const ruleAlwaysFail: ValidationRule = {
		name: 'AlwaysFail',
		check: (block) => ({ file: block.filePath, reason: 'Always fails' }),
	};

	const ruleFailForFileA: ValidationRule = {
		name: 'FailForFileA',
		check: (block) => (block.filePath === 'fileA.ts' ? { file: block.filePath, reason: 'FileA is not allowed' } : null),
	};

	it('should return all blocks as valid if no rules or all rules pass', () => {
		const blocks = [createEditBlock('file1.ts'), createEditBlock('file2.ts')];
		const result1 = validateBlocks(blocks, [], []);
		expect(result1.valid).to.deep.equal(blocks);
		expect(result1.issues).to.be.empty;

		const result2 = validateBlocks(blocks, [], [ruleAlwaysPass]);
		expect(result2.valid).to.deep.equal(blocks);
		expect(result2.issues).to.be.empty;
	});

	it('should return no valid blocks and all issues if a rule always fails', () => {
		const block1 = createEditBlock('file1.ts');
		const block2 = createEditBlock('file2.ts');
		const blocks = [block1, block2];
		const result = validateBlocks(blocks, [], [ruleAlwaysFail]);

		expect(result.valid).to.be.empty;
		expect(result.issues).to.deep.equal([
			{ file: 'file1.ts', reason: 'Always fails' },
			{ file: 'file2.ts', reason: 'Always fails' },
		]);
	});

	it('should correctly separate valid blocks and issues with mixed rules', () => {
		const blockA = createEditBlock('fileA.ts'); // Will fail ruleFailForFileA
		const blockB = createEditBlock('fileB.ts'); // Will pass ruleFailForFileA
		const blocks = [blockA, blockB];
		const repoFiles = ['fileB.ts']; // fileA does not exist

		// PathExistsRule: fileA fails (new file with non-empty originalText if default createEditBlock is used)
		// Let's make originalText empty for fileA to pass PathExistsRule for this specific test focus.
		const blockAValidForPath = createEditBlock('fileA.ts', '');
		const blocksForMixed = [blockAValidForPath, blockB];

		const rules: ValidationRule[] = [new PathExistsRule(), ruleFailForFileA];
		const result = validateBlocks(blocksForMixed, repoFiles, rules);

		expect(result.valid).to.deep.equal([blockB]);
		expect(result.issues).to.deep.equal([{ file: 'fileA.ts', reason: 'FileA is not allowed' }]);
	});

	it('should collect issues from multiple failing rules for the same block', () => {
		const block = createEditBlock('#fileA.ts', 'original content'); // Fails ModuleAlias, PathExists (if #fileA not in repoFiles)
		const repoFiles: string[] = [];
		const rules: ValidationRule[] = [new ModuleAliasRule(), new PathExistsRule()];
		const result = validateBlocks([block], repoFiles, rules);

		expect(result.valid).to.be.empty;
		expect(result.issues).to.have.lengthOf(2);
		expect(result.issues).to.deep.include.members([
			{
				file: '#fileA.ts',
				reason: `File path "#fileA.ts" should not begin with '#'. It seems like you're writing to a module alias. You need to write to a real file path.`,
			},
			{
				file: '#fileA.ts',
				reason: 'File does not exist, but the SEARCH block is not empty. To create a new file, the SEARCH block must be empty.',
			},
		]);
	});

	it('should handle empty blocks array', () => {
		const result = validateBlocks([], ['someFile.ts'], [ruleAlwaysFail]);
		expect(result.valid).to.be.empty;
		expect(result.issues).to.be.empty;
	});
});
