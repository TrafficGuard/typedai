import { expect } from 'chai';
import { SimilarFileNameRule } from './SimilarFileNameRule';
import type { EditBlock } from '../applySearchReplace';
import { setupConditionalLoggerOutput } from '#test/testUtils';

describe('SimilarFileNameRule', () => {
	setupConditionalLoggerOutput();

	const createEditBlock = (filePath: string): EditBlock => ({
		filePath,
		originalText: '', // Assuming for new file creation checks
		updatedText: 'updated',
	});

	describe('Parent Folder and Filename Similarity Check', () => {
		const rule = new SimilarFileNameRule(0.9, false, true); // Similarity disabled, parent check enabled

		it('should return an issue if new file path matches existing file in terms of filename and parent folder', () => {
			const block = createEditBlock('src/components/button.ts');
			const repoFiles = ['lib/components/button.ts', 'src/components/button.ts']; // Target file exists
			// This rule should not trigger if the file exists, so we test for a *new* path that is similar to an existing one.
			// Let's adjust the test: block.filePath is new, but similar to an existing one.
			const newBlock = createEditBlock('src/helpers/utils.ts'); // A new, non-problematic path
			const repoFilesForNew = ['lib/components/button.ts', 'src/components/card.ts'];
			expect(rule.check(newBlock, repoFilesForNew)).to.be.null; // No issue for a distinct new file

			// Test the actual case: new file path 'path3/path4/file' and existing 'path/path2/path3/path4/file'
			// The rule checks if block.filePath (new) has same name and parent as an existing file.
			const similarBlock = createEditBlock('moduleA/componentX/file.ts'); // Proposed new file
			const existingFiles = ['moduleB/componentY/file.ts', 'moduleA/componentZ/file.ts', 'moduleA/componentX/other.ts'];
			expect(rule.check(similarBlock, existingFiles)).to.be.null; // No exact parent/name match

			const conflictingBlock = createEditBlock('app/services/data.service.ts'); // Proposed new file
			const existingWithConflict = ['core/services/data.service.ts', 'app/utils/helper.ts'];
			// This should not conflict based on parent folder + name if the full path is different.
			// The logic is: if `editFileName === existingFileName && editParentFolder === existingParentFolder`
			// This means `block.filePath` itself would be identical to `existingFilePath` if they share same parent and name.
			// The rule is for *new* files. If block.filePath is in repoFiles, it returns null.
			// So, this check is for when block.filePath is NOT in repoFiles, but its name and parent match an existing one.
			// This implies a path like "a/b/c.ts" (new) vs "x/y/c.ts" (existing) where "b" and "y" are the parents.
			// The original test case: existingFilesNames = ['foo', 'path/path2/path3/path4/file']; editFilePath = 'path3/path4/file';
			// This implies editFilePath is a new file, but its parent 'path4' and name 'file' match a segment of an existing file.
			// This is subtle. The original code:
			// const editParts = editBlockFilePath.split(SEP); -> ['path3', 'path4', 'file']
			// const editFileName = 'file';
			// const editParentFolder = 'path4';
			// for (const filePath of filePaths) -> 'path/path2/path3/path4/file'
			//   const existingFileParts = filePath.split(SEP); -> ['path', 'path2', 'path3', 'path4', 'file']
			//   const existingFileName = 'file';
			//   const existingParentFolder = 'path4';
			//   if (editFileName === existingFileName && editParentFolder === existingParentFolder) -> true
			// This means if a *new* file path like "feature/components/myComponent.ts" is proposed,
			// and there's an *existing* file "core/components/myComponent.ts", it should flag it.

			const blockForParentCheck = createEditBlock('feature/components/myComponent.ts');
			const repoFilesForParentCheck = ['core/components/myComponent.ts', 'feature/services/data.ts'];
			const issue = rule.check(blockForParentCheck, repoFilesForParentCheck);
			expect(issue).to.deep.equal({
				file: 'feature/components/myComponent.ts',
				reason:
					"The proposed file path 'feature/components/myComponent.ts' has a filename and parent folder that match an existing file 'core/components/myComponent.ts'. Please verify the path.",
			});
		});

		it('should return null if new file path does not have filename/parent folder collision', () => {
			const block = createEditBlock('src/services/auth.service.ts');
			const repoFiles = ['src/components/button.ts', 'lib/utils/helper.ts'];
			expect(rule.check(block, repoFiles)).to.be.null;
		});

		it('should return null if the file path already exists in repoFiles (parent check)', () => {
			const block = createEditBlock('src/components/button.ts');
			const repoFiles = ['src/components/button.ts'];
			expect(rule.check(block, repoFiles)).to.be.null;
		});

		it('should return null if new file path has less than 2 parts (no parent folder)', () => {
			const block = createEditBlock('rootfile.ts');
			const repoFiles = ['src/components/button.ts'];
			expect(rule.check(block, repoFiles)).to.be.null;
		});
	});

	describe('String Similarity Check (when enabled)', () => {
		const rule = new SimilarFileNameRule(0.8, true, false); // Similarity enabled (threshold 0.8), parent check disabled

		it('should return an issue if new file path is very similar to an existing file path', () => {
			const block = createEditBlock('src/component/my-button.ts'); // Proposed new
			const repoFiles = ['src/components/my_button.ts']; // Existing
			const issue = rule.check(block, repoFiles);
			expect(issue).to.deep.equal({
				file: 'src/component/my-button.ts',
				reason:
					"The proposed file path 'src/component/my-button.ts' is very similar (similarity >= 0.8) to an existing file 'src/components/my_button.ts'. Please verify the path.",
			});
		});

		it('should return null if new file path is not similar enough to existing paths', () => {
			const block = createEditBlock('src/moduleA/featureX.ts');
			const repoFiles = ['lib/moduleB/serviceY.ts'];
			expect(rule.check(block, repoFiles)).to.be.null;
		});

		it('should return null if the file path already exists in repoFiles (similarity check)', () => {
			const block = createEditBlock('src/components/my_button.ts');
			const repoFiles = ['src/components/my_button.ts'];
			expect(rule.check(block, repoFiles)).to.be.null;
		});

		it('should be disabled by default', () => {
			const defaultRule = new SimilarFileNameRule(); // threshold 0.9, enabled false, parentCheck true
			const block = createEditBlock('src/component/my-button.ts');
			const repoFiles = ['src/components/my_button.ts']; // Similar
			// Parent check might trigger if paths are structured that way, but similarity check itself should not.
			// Let's use a path that only fails similarity:
			const blockSim = createEditBlock('src/compnents/mybutton.ts'); // typo, similar
			const repoFilesSim = ['src/components/mybutton.ts'];
			expect(defaultRule.check(blockSim, repoFilesSim)).to.be.null; // Similarity check is off by default
		});
	});

	describe('Combined Checks', () => {
		const rule = new SimilarFileNameRule(0.8, true, true); // All checks enabled

		it('parent folder check should take precedence if both would trigger', () => {
			// Path that is both a parent/name match AND highly similar string-wise
			const block = createEditBlock('feature/ui/button.ts');
			const repoFiles = ['core/ui/button.ts']; // Parent 'ui', name 'button' match. Also string similar.
			const issue = rule.check(block, repoFiles);
			expect(issue?.reason).to.contain('has a filename and parent folder that match');
		});
	});
});
