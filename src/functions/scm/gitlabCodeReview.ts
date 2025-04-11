import {
	type CommitDiffSchema,
	type DiscussionSchema,
	type ExpandedMergeRequestSchema,
	Gitlab as GitlabApi,
	type MergeRequestDiffSchema,
	type MergeRequestDiscussionNotePositionOptions,
	type ProjectSchema,
} from '@gitbeaker/rest';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { GitLab, type GitLabConfig } from '#functions/scm/gitlab';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { addCodeWithLineNumbers, generateReviewTaskFingerprint, reviewDiff, shouldApplyCodeReview } from '#swe/codeReview/codeReviewCommon';
import type { CodeReviewConfig, CodeReviewFingerprintCache, CodeReviewTask } from '#swe/codeReview/codeReviewModel';
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
		// TODO handle paging of results
		return diffs;
	}

	@span()
	async reviewMergeRequest(gitlabProjectId: string | number, mergeRequestIId: number): Promise<void> {
		const mergeRequest: ExpandedMergeRequestSchema = await this.api().MergeRequests.show(gitlabProjectId, mergeRequestIId);
		const diffs: MergeRequestDiffSchema[] = await this.getDiffs(gitlabProjectId, mergeRequestIId);
		const codeReviewService = appContext().codeReviewService;
		const codeReviewConfigs: CodeReviewConfig[] = (await codeReviewService.listCodeReviewConfigs()).filter((config) => config.enabled);
		const existingComments: DiscussionSchema[] = await this.api().MergeRequestDiscussions.all(gitlabProjectId, mergeRequestIId);
		const project = await this.gitlabSCM().getProject(gitlabProjectId);
		const projectPath = project.fullPath;
		// Load the hashes of the diffs we've already reviewed
		const reviewCache: CodeReviewFingerprintCache = await codeReviewService.getMergeRequestReviewCache(gitlabProjectId, mergeRequestIId);

		logger.info(`Reviewing MR "${mergeRequest.title}" in project "${projectPath}" (${mergeRequest.web_url}) with ${codeReviewConfigs.length} configs`);

		const codeReviewTasks: CodeReviewTask[] = [];

		// Pre-filter and check cache
		for (const diff of diffs) {
			if (diff.deleted_file || !diff.diff || diff.diff.trim() === '') continue;

			for (const config of codeReviewConfigs) {
				// Check if the code review config rules apply for this diff
				if (!shouldApplyCodeReview(config, projectPath, diff.new_path, diff.diff)) continue;

				const task = this.createCodeReviewTask(config, diff);

				if (reviewCache.fingerprints.has(task.fingerprint)) {
					logger.info(`Already reviewed ${config.title} in ${diff.new_path} for ${diff.diff.split('\n').slice(0, 1).join(' ')}`);
					continue;
				}

				codeReviewTasks.push(task);
			}
		}
		logger.info(`Found ${codeReviewTasks.length} review tasks needing LLM analysis.`);
		if (!codeReviewTasks.length) return;

		// Perform LLM Reviews
		const codeReviewActions = codeReviewTasks.map((task) => reviewDiff(task));
		const codeReviewResults = await allSettledAndFulFilled(codeReviewActions);

		// Post review comments
		for (const reviewResult of codeReviewResults) {
			reviewCache.fingerprints.add(reviewResult.task.fingerprint);

			if (!reviewResult.comments || !reviewResult.comments.length) continue;

			console.log(reviewResult.task.codeWithLineNums);

			for (const comment of reviewResult.comments) {
				logger.info({ comment }, `Adding review comment for "${reviewResult.task.config.title}" in ${reviewResult.task.filePath} [comment]`);

				// Prepare comment position data
				if (!mergeRequest.diff_refs?.base_sha || !mergeRequest.diff_refs?.head_sha || !mergeRequest.diff_refs?.start_sha) {
					logger.warn({ mrId: mergeRequest.id }, 'Cannot create comment position, missing diff_refs on merge request.');
					continue;
				}
				const position: MergeRequestDiscussionNotePositionOptions = {
					baseSha: mergeRequest.diff_refs.base_sha,
					headSha: mergeRequest.diff_refs.head_sha,
					startSha: mergeRequest.diff_refs.start_sha,
					oldPath: reviewResult.task.oldPath,
					newPath: reviewResult.task.filePath,
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
		const { codeWithLineNums, code } = addCodeWithLineNumbers(mrDiff.diff, mrDiff.new_path);

		const fingerprint = generateReviewTaskFingerprint(mrDiff.new_path, config.id, code);
		return {
			config,
			filePath: mrDiff.new_path,
			oldPath: mrDiff.old_path,
			// diff: mrDiff,
			codeWithLineNums,
			fingerprint,
			code,
		};
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
