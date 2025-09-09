import type { MergeRequestDiffSchema } from '@gitbeaker/rest';
import { expect } from 'chai';
import type { CodeReviewConfig } from '#shared/codeReview/codeReview.model';
import { addCodeWithLineNumbers, getStartingLineNumber, shouldApplyCodeReview } from '#swe/codeReview/codeReviewCommon';
import type { CodeReviewTask } from '#swe/codeReview/codeReviewTaskModel';

function codeReviewConfig(codeReview: Partial<CodeReviewConfig>) {
	return {
		id: crypto.randomUUID(),
		title: 'Test',
		description: 'Test',
		tags: [],
		examples: [],
		...codeReview,
	} as CodeReviewConfig;
}

describe('GitLabCodeReview', () => {
	describe('diff', () => {
		it('should get the starting line number', async () => {
			expect(getStartingLineNumber(' @@ -0,0 +1,76 @@\n+async function()[]\n{')).to.equal(1);
			expect(getStartingLineNumber(' @@ -0,0 +152,76 @@\n+async function()[]\n{')).to.equal(152);
		});
	});

	describe('applyCodeReview', () => {
		it('should return false when code review is disabled', () => {
			const codeReview = codeReviewConfig({
				enabled: false,
				projectPaths: [],
				fileExtensions: { include: ['*.ts'] },
				requires: { text: ['content'] },
			});

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.false;
		});

		it('should return false when project path does not match', () => {
			const codeReview = {
				enabled: true,
				projectPaths: ['allowed/project/*'],
				fileExtensions: { include: ['.ts'] },
				requires: { text: ['content'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/other/project';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.false;
		});

		it('should return false when file extension does not match', () => {
			const codeReview = codeReviewConfig({
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.js'] },
				requires: { text: ['content'] },
			});

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.false;
		});

		it('should return false when required text is not present in diff', () => {
			const codeReview = codeReviewConfig({
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.ts'] },
				requires: { text: ['specificKeyword'] },
			});

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content without the keyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.false;
		});

		it('should return true when all conditions are met', () => {
			const codeReview = {
				enabled: true,
				projectPaths: ['some/project/*'],
				fileExtensions: { include: ['.ts'] },
				requires: { text: ['specificKeyword'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'This diff includes the specificKeyword needed',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.true;
		});

		it('should not exclude projects when projectPaths is empty', () => {
			const codeReview = codeReviewConfig({
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.ts'] },
				requires: { text: ['keyword'] },
			});

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Contains keyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'any/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.true;
		});

		it('should return false when fileExtensions.include is empty', () => {
			// Note: This should not be a valid configuration
			const codeReview = codeReviewConfig({
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: [] },
				requires: { text: ['keyword'] },
			});

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Contains keyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.false;
		});

		it('should return false when requires.text is empty', () => {
			// Note: This should not be a valid configuration
			const codeReview = codeReviewConfig({
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.ts'] },
				requires: { text: [] },
			});

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.false;
		});

		it('should return true when file extension matches one of multiple', () => {
			const codeReview = codeReviewConfig({
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.js', '.ts'] },
				requires: { text: ['keyword'] },
			});

			const diff = {
				new_path: 'src/app/file.js',
				diff: 'Contains keyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.true;
		});

		it('should return true when diff contains any of the required texts', () => {
			const codeReview = codeReviewConfig({
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.ts'] },
				requires: { text: ['firstKeyword', 'secondKeyword'] },
			});

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'This diff includes secondKeyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const result = shouldApplyCodeReview(codeReview, projectPath, diff.new_path, diff.diff);
			expect(result).to.be.true;
		});
	});

	it('addCodeWithLineNumbers', () => {
		const sampleDiff = `@@ -0,0 +1,9 @@
+import dotenv from 'dotenv';
+dotenv.config();
+
+function handle() {
+  console.log('handling...')
+}
+
+handle();`;
		const expectedCode = `import dotenv from 'dotenv';
dotenv.config();

function handle() {
  console.log('handling...')
}

handle();`;
		const expectedCodeWithLineNums = `// 0
import dotenv from 'dotenv';
dotenv.config();
// 3
function handle() {
  console.log('handling...')
}
// 7
handle();`;
		const mrDiff: MergeRequestDiffSchema = {
			diff: sampleDiff,
			new_path: 'code.ts',
		} as MergeRequestDiffSchema;

		const { code, codeWithLineNums } = addCodeWithLineNumbers(mrDiff.diff, mrDiff.new_path);
		expect(code).to.equal(expectedCode);
		expect(codeWithLineNums).to.equal(expectedCodeWithLineNums);
	});
});
