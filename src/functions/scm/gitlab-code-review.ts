import crypto from 'node:crypto';
import {
	type CommitDiffSchema,
	type DiscussionSchema,
	type ExpandedMergeRequestSchema,
	Gitlab as GitlabApi,
	type MergeRequestDiffSchema,
	type MergeRequestDiscussionNotePositionOptions,
	type ProjectSchema,
} from '@gitbeaker/rest';
import * as micromatch from 'micromatch';
import { llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { GitLab, type GitLabConfig } from '#functions/scm/gitlab';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import {
	type CodeReviewConfig,
	type CodeReviewFingerprintCache,
	type CodeReviewResult,
	type CodeReviewTask,
	codeReviewToXml,
} from '#swe/codeReview/codeReviewModel';
import { functionConfig } from '#user/userService/userContext';
import { allSettledAndFulFilled } from '#utils/async-utils';
import { envVar } from '#utils/env-var';
import { appContext } from '../../applicationContext';
import { cacheRetry } from '../../cache/cacheRetry';
import type { SourceControlManagement } from './sourceControlManagement';

// Note that the type returned from getProjects is mapped to GitProject
export type GitLabProject = Pick<
	ProjectSchema,
	| 'id'
	| 'name'
	| 'description'
	| 'path_with_namespace'
	| 'http_url_to_repo'
	| 'default_branch'
	| 'archived'
	// | "shared_with_groups"
	| 'visibility'
	| 'owner'
	| 'ci_config_path'
>;

@funcClass(__filename)
export class GitLabCodeReview {
	// @ts-ignore
	_gitlab: GitlabApi;
	_config: GitLabConfig;
	_gitlabSCM: SourceControlManagement;

	private config(): GitLabConfig {
		if (!this._config) {
			const config = functionConfig(GitLab);
			if (!config.token && !envVar('GITLAB_TOKEN')) logger.error('No GitLab token configured on the user or environment');
			this._config = {
				host: config.host || envVar('GITLAB_HOST'),
				token: config.token || envVar('GITLAB_TOKEN'),
				topLevelGroups: (config.topLevelGroups || envVar('GITLAB_GROUPS')).split(',').map((group: string) => group.trim()),
			};
		}
		return this._config;
	}

	// @ts-ignore
	private api(): GitlabApi {
		this._gitlab ??= new GitlabApi({
			host: `https://${this.config().host}`,
			token: this.config().token,
		});
		return this._gitlab;
	}

	private gitlabSCM(): SourceControlManagement {
		this._gitlabSCM ??= new GitLab();
		return this._gitlabSCM;
	}

	@cacheRetry()
	@span()
	async getDiffs(gitlabProjectId: string | number, mergeRequestIId: number): Promise<MergeRequestDiffSchema[]> {
		const diffs = await this.api().MergeRequests.allDiffs(gitlabProjectId, mergeRequestIId);
		if (diffs.length === 100) {
		}
		return diffs;
	}

	@span()
	async reviewMergeRequest(gitlabProjectId: string | number, mergeRequestIId: number): Promise<void> {
		const mergeRequest: ExpandedMergeRequestSchema = await this.api().MergeRequests.show(gitlabProjectId, mergeRequestIId);
		// console.log(mergeRequest)
		const diffs: MergeRequestDiffSchema[] = await this.getDiffs(gitlabProjectId, mergeRequestIId);
		// console.log(diffs)
		const codeReviewService = appContext().codeReviewService;
		const codeReviewConfigs: CodeReviewConfig[] = (await codeReviewService.listCodeReviewConfigs()).filter((config) => config.enabled);
		const existingComments: DiscussionSchema[] = await this.api().MergeRequestDiscussions.all(gitlabProjectId, mergeRequestIId);
		const project = await this.gitlabSCM().getProject(gitlabProjectId);
		const projectPath = project.fullPath;
		// Load the hashes of the diffs we've already reviewed
		const reviewCache: CodeReviewFingerprintCache = await codeReviewService.getMergeRequestReviewCache(gitlabProjectId, mergeRequestIId);

		logger.info(`Reviewing MR "${mergeRequest.title}" in project "${projectPath}" (${mergeRequest.web_url}) with ${codeReviewConfigs.length} configs`);

		const codeReviewTasks: CodeReviewTask[] = [];

		// Pre-filter and check cache ---
		for (const diff of diffs) {
			if (diff.deleted_file || !diff.diff || diff.diff.trim() === '') continue;

			for (const codeReviewConfig of codeReviewConfigs) {
				// Check if the code review config rules apply for this diff
				if (!this.shouldApplyCodeReview(codeReviewConfig, diff, projectPath)) continue;

				codeReviewTasks.push(this.createCodeReviewTask(codeReviewConfig, diff));
			}
		}
		logger.info(`Found ${codeReviewTasks.length} review tasks needing LLM analysis.`);
		if (!codeReviewTasks.length) return;

		// Perform LLM Reviews
		const codeReviewActions = codeReviewTasks.map((task) => this.reviewDiff(task));
		const codeReviewResults = await allSettledAndFulFilled(codeReviewActions);

		// Post review comments
		for (const reviewResult of codeReviewResults) {
			reviewCache.fingerprints.add(reviewResult.task.fingerprint);

			if (!reviewResult.comments || !reviewResult.comments.length) continue;

			console.log(reviewResult.task.codeWithLineNums);

			for (const comment of reviewResult.comments) {
				logger.info({ comment }, `Adding review comment for "${reviewResult.task.config.title}" in ${reviewResult.task.diff.new_path} [comment]`);

				// Prepare comment position data
				if (!mergeRequest.diff_refs?.base_sha || !mergeRequest.diff_refs?.head_sha || !mergeRequest.diff_refs?.start_sha) {
					logger.warn({ mrId: mergeRequest.id }, 'Cannot create comment position, missing diff_refs on merge request.');
					continue;
				}
				const position: MergeRequestDiscussionNotePositionOptions = {
					baseSha: mergeRequest.diff_refs.base_sha,
					headSha: mergeRequest.diff_refs.head_sha,
					startSha: mergeRequest.diff_refs.start_sha,
					oldPath: reviewResult.task.diff.old_path,
					newPath: reviewResult.task.diff.new_path,
					positionType: 'text',
					newLine: comment.lineNumber > 0 ? comment.lineNumber.toString() : undefined,
				};
				Object.keys(position).forEach((key) => position[key] === undefined && delete position[key]);
				const positionOptions = position.newLine ? { position } : undefined;
				console.log(positionOptions);
				try {
					// const discussion = await this.api().MergeRequestDiscussions.create(gitlabProjectId, mergeRequestIId, comment.comment, positionOptions);
					// console.log(discussion)
				} catch (e) {
					const message = e.cause?.description || e.message;
					logger.warn(
						{ error: e, comment: comment.comment, lineNumber: comment.lineNumber, positionOptions, errorKey: 'GitLab create code review discussion' },
						`Error creating code review comment: ${message}`,
					);
				}
			}
		}

		await codeReviewService.updateMergeRequestReviewCache(gitlabProjectId, mergeRequestIId, reviewCache);
	}

	createCodeReviewTask(config: CodeReviewConfig, mrDiff: MergeRequestDiffSchema): CodeReviewTask {
		const { codeWithLineNums, code } = this.addCodeWithLineNumbers(mrDiff);

		const fingerprint = generateReviewTaskFingerprint(mrDiff.new_path, config.id, code);
		return {
			config,
			diff: mrDiff,
			codeWithLineNums,
			fingerprint,
			code,
		};
	}

	/**
	 * Sets the codeWithLinesNums property on the task, which is a copy of the diff with line numbers added as comments
	 * @param mrDiff
	 */
	addCodeWithLineNumbers(mrDiff: MergeRequestDiffSchema): { codeWithLineNums: string; code: string } {
		// The first line of the diff has the starting line number e.g. @@ -0,0 +1,76 @@
		let startingLineNumber = getStartingLineNumber(mrDiff.diff);

		const lineCommenter = getBlankLineCommenter(mrDiff.new_path);

		// Transform the diff, so it's not a diff, removing the deleted lines so only the unchanged and new lines remain
		// i.e. the code in the latest commit
		const diffLines: string[] = mrDiff.diff
			.trim()
			.split('\n')
			.filter((line) => !line.startsWith('-'))
			.map((line) => (line.startsWith('+') ? line.slice(1) : line));

		// The current state of the code
		const rawCode = diffLines.slice(1).join('\n');

		startingLineNumber -= 1;
		diffLines[0] = lineCommenter(startingLineNumber);

		// Add lines numbers
		for (let i = 1; i < diffLines.length; i++) {
			const line = diffLines[i];
			// Add the line number on blank lines
			if (!line.trim().length) diffLines[i] = lineCommenter(startingLineNumber + i);
			// Could add in a line number at least every 10 lines if the file type supports closing comments i.e. /* */
			// Or add the line numbers at the end of the line in a single line comment
		}

		return {
			code: rawCode,
			codeWithLineNums: diffLines.join('\n'),
		};
	}

	/**
	 * Determine if a particular code review configuration is valid to perform on a diff
	 * @param codeReview
	 * @param diff
	 * @param projectPath
	 */
	shouldApplyCodeReview(codeReview: CodeReviewConfig, diff: MergeRequestDiffSchema, projectPath: string): boolean {
		if (!codeReview.enabled) return false;

		// If project paths are provided, then there must be a match
		if (codeReview.projectPaths.length && !micromatch.isMatch(projectPath, codeReview.projectPaths)) {
			console.log(`Project path globs ${codeReview.projectPaths} dont match ${projectPath}`);
			return false;
		}

		const hasMatchingExtension = codeReview.fileExtensions?.include.some((extension) => diff.new_path.endsWith(extension));
		const hasRequiredText = codeReview.requires?.text.some((text) => diff.diff.includes(text));
		// File extension and requires text are mandatory fields
		return hasMatchingExtension && hasRequiredText;
	}

	/**
	 * Review a diff from a merge request using the code review guidelines configured by the files in resources/codeReview
	 * @param task
	 */
	async reviewDiff(task: CodeReviewTask): Promise<CodeReviewResult> {
		const prompt = `You are an AI software engineer tasked with reviewing code changes for our software development style standards.

Review Configuration:
${codeReviewToXml(task.config)}

Code to Review:
<code-diff>
${task.code}
</code-diff>

Instructions:
1. Based on the provided code review guidelines, analyze the code changes from a diff and identify any potential violations.
2. Consider the overall context and purpose of the code when identifying violations.
3. Comments with a number at the start of lines indicate line numbers. Use these numbers to help determine the starting lineNumber for the review comment. The comment should be on the line after the offending code.
4. Provide the review comments in the following JSON format. If no review violations are found return an empty array for violations.

{
  "thinking": "(thinking and observations about the code and code review config)"
  "violations": [
    {
      "lineNumber": number,
      "comment": "Explanation of the violation and suggestion for valid code in Markdown format"
    }
  ]
}

Response only in JSON format. Do not wrap the JSON in any tags.
`;
		const reviewComments = (await llms().medium.generateJson(prompt, { id: 'Diff code review', temperature: 0.5 })) as {
			violations: Array<{ lineNumber: number; comment: string }>;
		};
		// TODO ensure response is the correct type by setting a schema or checking the results
		console.log('LLM');
		console.log(reviewComments);
		return { task, comments: reviewComments.violations };
	}

	/**
	 * Gets the logs for a CI/CD job
	 * @param projectIdOrProjectPath full path or numeric id
	 * @param jobId the job id
	 */
	@func()
	async getJobLogs(projectIdOrProjectPath: string | number, jobId: string): Promise<string> {
		if (!projectIdOrProjectPath) throw new Error('Parameter "projectPath" must be truthy');
		if (!jobId) throw new Error('Parameter "jobId" must be truthy');

		const project = await this.api().Projects.show(projectIdOrProjectPath);
		const job = await this.api().Jobs.show(project.id, jobId);

		return await this.api().Jobs.showLog(project.id, job.id);
	}

	/**
	 * Returns the Git diff for the commit in the git repository that the job is running the pipeline on.
	 * @param projectPath full project path or numeric id
	 * @param jobId the job id
	 */
	@func()
	async getJobCommitDiff(projectPath: string, jobId: string): Promise<string> {
		if (!projectPath) throw new Error('Parameter "projectPath" must be truthy');
		if (!jobId) throw new Error('Parameter "jobId" must be truthy');

		const project = await this.api().Projects.show(projectPath);
		const job = await this.api().Jobs.show(project.id, jobId);

		const commitDetails: CommitDiffSchema[] = await this.api().Commits.showDiff(projectPath, job.commit.id);
		return commitDetails.map((commitDiff) => commitDiff.diff).join('\n');
	}
}

export function getStartingLineNumber(diff: string): number {
	diff = diff.slice(diff.indexOf('+'));
	diff = diff.slice(0, diff.indexOf(','));
	return Number.parseInt(diff);
}

function getBlankLineCommenter(fileName: string): (lineNumber: number) => string {
	const extension = fileName.split('.').pop();

	switch (extension) {
		case 'js':
		case 'ts':
		case 'java':
		case 'c':
		case 'cpp':
		case 'cs':
		case 'css':
		case 'php':
		case 'swift':
		case 'm': // Objective-C
		case 'go':
		case 'kt': // Kotlin
		case 'kts': // Kotlin script
		case 'groovy':
		case 'scala':
		case 'dart':
			return (lineNumber) => `// ${lineNumber}`;
		case 'py':
		case 'sh':
		case 'pl': // Perl
		case 'rb':
		case 'yaml':
		case 'yml':
		case 'tf':
		case 'r':
			return (lineNumber) => `# ${lineNumber}`;
		case 'html':
		case 'xml':
		case 'jsx':
			return (lineNumber) => `<!-- ${lineNumber} -->`;
		case 'sql':
			return (lineNumber) => `-- ${lineNumber}`;
		case 'ini':
			return (lineNumber) => `; ${lineNumber}`;
		case 'hs': // Haskell
		case 'lsp': // Lisp
		case 'scm': // Scheme
			return (lineNumber) => `-- ${lineNumber}`;
		default:
			// No line number comment if file type is unrecognized
			return (lineNumber) => '';
	}
}

/** Generate fingerprint for caching reviews */
function generateReviewTaskFingerprint(filePath: string, ruleId: string, diffContents: string): string {
	const data = [`file:${filePath}`, `rule:${ruleId}`, `content:${diffContents}`].join('|');
	return crypto.createHash('sha256').update(data).digest('hex');
}
