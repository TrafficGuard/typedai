import { MergeRequestDiffSchema } from '@gitbeaker/rest';
import { expect } from 'chai';
import sinon from 'sinon';
import { GitLabCodeReview, getStartingLineNumber } from '#functions/scm/gitlab-code-review';
import { CodeReviewConfig } from '#swe/codeReview/codeReviewModel';

describe('GitLabCodeReview', () => {
	describe('diff', () => {
		it('should get the starting line number', async () => {
			expect(getStartingLineNumber(' @@ -0,0 +1,76 @@\n+async function()[]\n{')).to.equal(1);
			expect(getStartingLineNumber(' @@ -0,0 +152,76 @@\n+async function()[]\n{')).to.equal(152);
		});
	});

	describe('applyCodeReview', () => {
		it('should return false when code review is disabled', () => {
			const codeReview = {
				enabled: false,
				projectPaths: [],
				fileExtensions: { include: ['*.ts'] },
				requires: { text: ['content'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
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

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
			expect(result).to.be.false;
		});

		it('should return false when file extension does not match', () => {
			const codeReview = {
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.js'] },
				requires: { text: ['content'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
			expect(result).to.be.false;
		});

		it('should return false when required text is not present in diff', () => {
			const codeReview = {
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.ts'] },
				requires: { text: ['specificKeyword'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content without the keyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
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

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
			expect(result).to.be.true;
		});

		it('should not exclude projects when projectPaths is empty', () => {
			const codeReview = {
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.ts'] },
				requires: { text: ['keyword'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Contains keyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'any/project/path';

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
			expect(result).to.be.true;
		});

		it('should return false when fileExtensions.include is empty', () => {
			// Note: This should not be a valid configuration
			const codeReview = {
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: [] },
				requires: { text: ['keyword'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Contains keyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
			expect(result).to.be.false;
		});

		it('should return false when requires.text is empty', () => {
			// Note: This should not be a valid configuration
			const codeReview = {
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.ts'] },
				requires: { text: [] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'Some diff content',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
			expect(result).to.be.false;
		});

		it('should return true when file extension matches one of multiple', () => {
			const codeReview = {
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.js', '.ts'] },
				requires: { text: ['keyword'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.js',
				diff: 'Contains keyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
			expect(result).to.be.true;
		});

		it('should return true when diff contains any of the required texts', () => {
			const codeReview = {
				enabled: true,
				projectPaths: [],
				fileExtensions: { include: ['.ts'] },
				requires: { text: ['firstKeyword', 'secondKeyword'] },
			} as CodeReviewConfig;

			const diff = {
				new_path: 'src/app/file.ts',
				diff: 'This diff includes secondKeyword',
			} as MergeRequestDiffSchema;

			const projectPath = 'some/project/path';

			const gitLab = new GitLabCodeReview();
			const result = gitLab.shouldApplyCodeReview(codeReview, diff, projectPath);
			expect(result).to.be.true;
		});
	});

	// describe('getJobLogs', () => {
	// 	let gitLab: GitLab;
	// 	let apiStub: sinon.SinonStubbedInstance<Gitlab>;
	//
	// 	beforeEach(() => {
	// 		gitLabServer = new GitLabServer();
	// 		apiStub = sinon.createStubInstance(Gitlab);
	// 		gitLabServer.api = apiStub;
	// 	});
	//
	// 	it('should get the job logs', async () => {
	// 		const projectPath = 'some/project';
	// 		const jobId = 123;
	// 		const project = { id: 1 };
	// 		const job = { id: jobId };
	// 		const logs = 'Job logs content';
	//
	// 		apiStub.Projects.show.resolves(project);
	// 		apiStub.Jobs.show.resolves(job);
	// 		apiStub.Jobs.trace.resolves(logs);
	//
	// 		const result = await gitLab.getJobLogs(projectPath, jobId);
	// 		expect(result).to.equal(logs);
	// 	});
	// });
});
