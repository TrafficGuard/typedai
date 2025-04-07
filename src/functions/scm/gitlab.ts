import { existsSync } from 'fs';
import fs from 'node:fs';
import { join } from 'path';
import { JobSchema, UserSchema } from '@gitbeaker/core';
import {
	CommitDiffSchema,
	CreateMergeRequestOptions,
	ExpandedMergeRequestSchema,
	Gitlab as GitlabApi,
	MergeRequestDiffSchema,
	PipelineSchema,
	ProjectSchema,
} from '@gitbeaker/rest';
import { DeepPartial } from 'ai';
import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { GITLAB_SHARED_REPOS_PATH } from '#functions/scm/sourceControlManagementTypes';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { CodeReviewConfig } from '#swe/codeReview/codeReviewModel';
import { getProjectInfo } from '#swe/projectDetection';
import { currentUser, functionConfig } from '#user/userService/userContext';
import { envVar } from '#utils/env-var';
import { execCommand, failOnError } from '#utils/exec';
import { GitProject } from './gitProject';
import { MergeRequest, SourceControlManagement } from './sourceControlManagement';

export interface GitLabConfig {
	host: string;
	token: string;
	secretName?: string;
	secretProject?: string;
	/** Comma seperated list of the top level groups */
	topLevelGroups: string[];
	groupExcludes?: Set<string>;
}

/**
 * AI review of a git diff
 */
interface DiffReview {
	mrDiff: MergeRequestDiffSchema;
	/** The code being reviewed from the diff */
	code: string;
	/** Code review comments */
	comments: Array<{ comment: string; lineNumber: number }>;
	/** The code review configuration */
	reviewConfig: CodeReviewConfig;
}

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

type PartialJobSchema = DeepPartial<JobSchema>;

type PipelineWithJobs = PipelineSchema & { jobs: PartialJobSchema[] };

@funcClass(__filename)
export class GitLab implements SourceControlManagement {
	_gitlab;
	_config: GitLabConfig;

	toJSON() {
		this.api();
		return {
			host: this.config().host,
		};
	}

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

	private api(): any {
		this._gitlab ??= new GitlabApi({
			host: `https://${this.config().host}`,
			token: this.config().token,
		});
		return this._gitlab;
	}

	// /**
	//  * Searches the descriptions of all the projects in GitLab to find the project which has the files to edit to complete the requirements
	//  * @param requirements the task requirements
	//  * @returns the GitLab project details (name, git URL etc)
	//  */
	// async selectProject(requirements: string): Promise<GitLabProject> {
	// 	const projects = await this.getProjects();
	// 	const prompt = buildPrompt({
	// 		information: `The following is a list of our projects:\n<projects>${JSON.stringify(projects)}</projects>`,
	// 		requirements,
	// 		action:
	// 			'Select the project object which most closely matches the task and return the object. Output your answer in JSON format',
	// 	});
	//
	// 	const project = await llms().medium.generateTextAsJson(prompt);
	// 	return project;
	// }

	/**
	 * @returns the details of all the projects available
	 */
	@func()
	async getProjects(): Promise<GitProject[]> {
		const resultProjects: GitProject[] = [];
		for (const group of this.config().topLevelGroups) {
			const projects = await this.api().Groups.allProjects(group, {
				orderBy: 'name',
				perPage: 500,
			});
			if (projects.length === 500) throw new Error('Need to page results for GitLab.getProjects. Exceeded 500 size');
			// console.log(`${group} ==========`);
			projects.sort((a, b) => a.path.localeCompare(b.path));
			projects.map((project) => this.convertGitLabToGitProject(project)).forEach((project) => resultProjects.push(project));

			const descendantGroups = await this.api().Groups.allDescendantGroups(group, {});
			for (const descendantGroup of descendantGroups) {
				if (descendantGroup.full_name.includes('Archive')) continue;
				if (this.config().groupExcludes?.has(descendantGroup.full_path)) continue;

				// console.log(`${descendantGroup.full_path} ==========`);
				const pageSize = 100;
				const projects = await this.api().Groups.allProjects(descendantGroup.id, {
					orderBy: 'name',
					perPage: 100,
				});
				if (projects.length >= pageSize) {
					throw new Error(`Need pagination for projects for group ${group}. Returned more than ${pageSize}`);
				}
				projects.sort((a, b) => a.path.localeCompare(b.path));
				projects.map((project) => this.convertGitLabToGitProject(project)).forEach((project) => resultProjects.push(project));
			}
		}

		return resultProjects;
	}

	async getProject(projectId: string | number): Promise<GitProject> {
		const project = await this.api().Projects.show(projectId);
		return this.convertGitLabToGitProject(project);
	}

	private convertGitLabToGitProject(project: ProjectSchema): GitProject {
		if (!project.default_branch) logger.warn(`Defaulting ${project.name} default branch to main`);
		return {
			id: project.id,
			name: project.name,
			namespace: project.namespace.full_path,
			fullPath: `${project.namespace.full_path}/${project.path}`,
			description: project.description,
			defaultBranch: project.default_branch,
			visibility: project.visibility,
			archived: project.archived || false,
			extra: { ciConfigPath: project.ci_config_path },
		};
	}

	/**
	 * Clones a project from GitLab to the file system.
	 * To use this project the function FileSystem.setWorkingDirectory must be called after with the returned value
	 * @param projectPathWithNamespace the full project path in GitLab
	 * @returns the file system path where the repository is located. You will need to call FileSystem_setWorkingDirectory() with this result to work with the project.
	 */
	@func()
	async cloneProject(projectPathWithNamespace: string): Promise<string> {
		if (!projectPathWithNamespace) throw new Error('Parameter "projectPathWithNamespace" must be truthy');
		const path = join(GITLAB_SHARED_REPOS_PATH, projectPathWithNamespace);
		const fss = getFileSystem();

		// If the project already exists pull updates from the main/dev branch
		if (existsSync(path) && existsSync(join(path, '.git'))) {
			const currentWorkingDir = fss.getWorkingDirectory();
			try {
				fss.setWorkingDirectory(path);
				logger.info(`${projectPathWithNamespace} exists at ${path}. Pulling updates`);

				// If the repo has a projectInfo.json file with a devBranch defined, then switch to that
				// else switch to the default branch defined in the GitLab project
				const projectInfo = await getProjectInfo();
				if (projectInfo.devBranch) {
					await fss.getVcs().switchToBranch(projectInfo.devBranch);
				} else {
					const gitProject = await this.getProject(projectPathWithNamespace);
					const switchResult = await execCommand(`git switch ${gitProject.defaultBranch}`, { workingDirectory: path });
					if (switchResult.exitCode === 0) logger.info(`Switched to branch ${gitProject.defaultBranch}`);
				}

				const fetchResult = await execCommand(`git -C ${path} fetch`);
				failOnError('Failed to fetch updates', fetchResult);
				const pullResult = await execCommand(`git -C ${path} pull`);
				failOnError('Failed to pull updates', pullResult);
			} finally {
				// Current behaviour of this function is to not change the working directory
				fss.setWorkingDirectory(currentWorkingDir);
			}
		} else {
			logger.info(`Cloning project: ${projectPathWithNamespace} to ${path}`);
			await fs.promises.mkdir(path, { recursive: true });
			const command = `git clone https://oauth2:${this.config().token}@${this.config().host}/${projectPathWithNamespace}.git ${path}`;
			const result = await execCommand(command, { mask: this.config().token });

			if (result.stderr?.includes('remote HEAD refers to nonexistent ref')) {
				const gitProject = await this.getProject(projectPathWithNamespace);
				const switchResult = await execCommand(`git switch ${gitProject.defaultBranch}`, { workingDirectory: path });
				if (switchResult.exitCode === 0) logger.info(`Switched to branch ${gitProject.defaultBranch}`);
				failOnError(`Unable to switch to default branch ${gitProject.defaultBranch} for ${projectPathWithNamespace}`, switchResult);
			}

			failOnError(`Failed to clone ${projectPathWithNamespace}`, result);
		}
		agentContext().memory[`GitLab_project_${projectPathWithNamespace.replace('/', '_')}_FileSystem_directory_`] = path;
		return path;
	}

	/**
	 * Creates a Merge request
	 * @param projectId The full project path or numeric id
	 * @param {string} title The title of the merge request
	 * @param {string} description The description of the merge request
	 * @param sourceBranch The branch to merge in
	 * @param {string} targetBranch The branch to merge to
	 * @return the merge request URL
	 */
	@func()
	async createMergeRequest(projectId: string | number, title: string, description: string, sourceBranch: string, targetBranch: string): Promise<MergeRequest> {
		// TODO if the user has changed their gitlab token, then need to update the origin URL with it
		// Can't get the options to create the merge request
		// -o merge_request.create -o merge_request.target='${targetBranch}' -o merge_request.remove_source_branch -o merge_request.title=${shellEscape(title)} -o merge_request.description=${shellEscape(description)}

		const cmd = `git push --set-upstream origin '${sourceBranch}'`;
		const { exitCode, stdout, stderr } = await execCommand(cmd);
		if (exitCode > 0) throw new Error(`${stdout}\n${stderr}`);

		const email = currentUser().email;
		const userResult: UserSchema | UserSchema[] = await this.api().Users.all({ search: email });
		let user: UserSchema | undefined;
		if (!Array.isArray(userResult)) user = userResult;
		else if (Array.isArray(userResult) && userResult.length === 1) user = userResult[0];

		const options: CreateMergeRequestOptions = { description, squash: true, removeSourceBranch: true, assigneeId: user?.id, reviewerId: user?.id };
		const mr: ExpandedMergeRequestSchema = await this.api().MergeRequests.create(projectId, sourceBranch, targetBranch, title, options);

		return {
			id: mr.id,
			iid: mr.iid,
			url: mr.web_url,
			title: mr.title,
		};
	}

	/**
	 * Gets the latest pipeline details from a merge request
	 * @param gitlabProjectId The full path or numeric id
	 * @param mergeRequestIId The merge request IID. Can be found in the URL to a pipeline
	 */
	@func()
	async getLatestMergeRequestPipeline(gitlabProjectId: string | number, mergeRequestIId: number): Promise<PipelineWithJobs> {
		// allPipelines<E extends boolean = false>(projectId: string | number, mergerequestIId: number, options?: Sudo & ShowExpanded<E>): Promise<GitlabAPIResponse<Pick<PipelineSchema, 'id' | 'sha' | 'ref' | 'status'>[], C, E, void>>;
		const pipelines: PipelineSchema[] = await this.api().MergeRequests.allPipelines(gitlabProjectId, mergeRequestIId);

		if (pipelines.length === 0) return null;

		pipelines.sort((a, b) => (Date.parse(a.created_at) < Date.parse(b.created_at) ? 1 : -1));

		const latestPipeline = pipelines.at(0);

		const fullJobs: JobSchema[] = await this.api().Jobs.all(gitlabProjectId, { pipelineId: latestPipeline.id });
		const jobs: PartialJobSchema[] = fullJobs.map((job) => {
			return {
				id: job.id,
				status: job.status,
				stage: job.stage,
				name: job.name,
				allow_failure: job.allow_failure,

				started_at: job.started_at,
				finished_at: job.finished_at,
				duration: job.duration,
				failure_reason: job.failure_reason,
				user: {
					username: job.user.username,
				},
				commit: {
					id: job.commit.id,
					created_at: job.commit.created_at,
					author_email: job.commit.author_email,
					title: job.commit.title,
					message: job.commit.message,
				},
			};
		});
		return {
			...latestPipeline,
			jobs,
		};
	}

	/**
	 * Gets the logs from the jobs which have failed in a pipeline Returns a Map with the job name as the key and the logs as the value.
	 * If the request has provided a URL to the merge request then the projectId and mergeRequestIId can be extracted from the URL
	 * @param gitlabProjectId Either the full path or the numeric id
	 * @param mergeRequestIId The merge request IID. Can get this from the URL of the merge request.
	 */
	@func()
	async getFailedJobLogs(gitlabProjectId: string | number, mergeRequestIId: number) {
		const pipelines: PipelineSchema[] = await this.api().MergeRequests.allPipelines(gitlabProjectId, mergeRequestIId);
		if (pipelines.length === 0) throw new Error('No pipelines for the merge request');
		pipelines.sort((a, b) => (Date.parse(a.created_at) < Date.parse(b.created_at) ? 1 : -1));
		const latestPipeline = pipelines.at(0);
		if (latestPipeline.status !== 'failed' && latestPipeline.status !== 'blocked') throw new Error('Pipeline is not failed or blocked');

		const jobs: JobSchema[] = await this.api().Jobs.all(gitlabProjectId, { pipelineId: latestPipeline.id });

		const failedJobs = jobs.filter((job) => job.status === 'failed' && job.allow_failure === false);

		const jobLogs = {};
		for (const job of failedJobs) {
			jobLogs[job.name] = await this.getJobLogs(gitlabProjectId, job.id.toString());
		}
		return jobLogs;
	}

	/**
	 * @returns the diffs for a merge request
	 */
	// @cacheRetry({ scope: 'execution' })
	@span()
	async getMergeRequestDiffs(gitlabProjectId: string | number, mergeRequestIId: number): Promise<string> {
		const diffs: MergeRequestDiffSchema[] = await this.api().MergeRequests.allDiffs(gitlabProjectId, mergeRequestIId, { perPage: 20 });
		let result = '<git-diffs>';

		for (const fileDiff of diffs) {
			// Strip out the deleted lines in the diff
			// Then remove the + character, so we're
			// left with the current code.
			const diff = fileDiff.diff;
			// .split('\n')
			// .filter((line) => !line.startsWith('-'))
			// .map((line) => (line.startsWith('+') ? line.slice(1) : line))
			// .join('\n');
			result += `<diff path="${fileDiff.new_path}">\n${diff}\n</diff>\n`;
		}
		return result;
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
}
