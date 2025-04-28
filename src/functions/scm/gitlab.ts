import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { JobSchema, UserSchema } from '@gitbeaker/core';
import {
	type CommitDiffSchema,
	type CreateMergeRequestOptions,
	type ExpandedMergeRequestSchema,
	Gitlab as GitlabApi,
	type MergeRequestDiffSchema,
	type PipelineSchema,
	type ProjectSchema,
} from '@gitbeaker/rest';
import type { BranchSchema } from '@gitbeaker/rest';
import type { DeepPartial } from 'ai';
import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import type { ToolType } from '#functions/toolType';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { getProjectInfo } from '#swe/projectDetection';
import { currentUser, functionConfig } from '#user/userService/userContext';
import { envVar } from '#utils/env-var';
import { execCommand, failOnError } from '#utils/exec';
import { agentDir, systemDir } from '../../appVars';
import type { GitProject } from './gitProject';
import type { MergeRequest, SourceControlManagement } from './sourceControlManagement';

export interface GitLabConfig {
	host: string;
	token: string;
	secretName?: string;
	secretProject?: string;
	/** Comma seperated list of the top level groups */
	topLevelGroups: string[];
	groupExcludes?: Set<string>;
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

	/**
	 * Checks if the GitLab configuration (token, host, groups) is available.
	 * @returns {boolean} True if configured, false otherwise.
	 */
	isConfigured(): boolean {
		// Attempt to get config without triggering the error logging in the config() method
		const config = functionConfig(GitLab) as GitLabConfig;
		const token = config?.token || process.env.GITLAB_TOKEN;
		const host = config?.host || process.env.GITLAB_HOST;
		const groups = config?.topLevelGroups || process.env.GITLAB_GROUPS;

		return !!(token && host && groups);
	}

	toJSON() {
		this.api();
		return {
			host: this.config().host,
		};
	}

	getToolType(): ToolType {
		return 'scm';
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

		const fss = getFileSystem();
		const agent = agentContext();
		const basePath = agent.useSharedRepos ? join(systemDir(), 'gitlab') : join(agentDir(), 'gitlab');
		const targetPath = join(basePath, projectPathWithNamespace);
		await fs.mkdir(targetPath, { recursive: true }); // Ensure folder exists

		// If the project already exists pull updates from the main/dev branch
		if (existsSync(targetPath) && existsSync(join(targetPath, '.git'))) {
			const currentWorkingDir = fss.getWorkingDirectory();
			try {
				fss.setWorkingDirectory(targetPath);
				logger.info(`${projectPathWithNamespace} exists at ${targetPath}. Pulling updates`);

				// If the repo has a projectInfo.json file with a devBranch defined, then switch to that
				// else switch to the default branch defined in the GitLab project
				const projectInfo = await getProjectInfo();
				if (projectInfo.devBranch) {
					await fss.getVcs().switchToBranch(projectInfo.devBranch);
				} else {
					const gitProject = await this.getProject(projectPathWithNamespace);
					const switchResult = await execCommand(`git switch ${gitProject.defaultBranch}`, { workingDirectory: targetPath });
					if (switchResult.exitCode === 0) logger.info(`Switched to branch ${gitProject.defaultBranch}`);
				}

				const fetchResult = await execCommand('git fetch', { workingDirectory: targetPath });
				failOnError('Failed to fetch updates', fetchResult);
				const pullResult = await execCommand('git pull', { workingDirectory: targetPath });
				failOnError('Failed to pull updates', pullResult);
			} finally {
				// Current behaviour of this function is to not change the working directory
				fss.setWorkingDirectory(currentWorkingDir);
			}
		} else {
			logger.info(`Cloning project: ${projectPathWithNamespace} to ${targetPath}`);
			// Parent directory created above, git clone creates the final directory
			const command = `git clone https://oauth2:${this.config().token}@${this.config().host}/${projectPathWithNamespace}.git ${targetPath}`;
			const result = await execCommand(command, { mask: this.config().token });

			if (result.stderr?.includes('remote HEAD refers to nonexistent ref')) {
				const gitProject = await this.getProject(projectPathWithNamespace);
				const switchResult = await execCommand(`git switch ${gitProject.defaultBranch}`, { workingDirectory: targetPath });
				if (switchResult.exitCode === 0) logger.info(`Switched to branch ${gitProject.defaultBranch}`);
				failOnError(`Unable to switch to default branch ${gitProject.defaultBranch} for ${projectPathWithNamespace}`, switchResult);
			}

			failOnError(`Failed to clone ${projectPathWithNamespace}`, result);
		}
		agentContext().memory[`GitLab_project_${projectPathWithNamespace.replace(/\//g, '_')}_FileSystem_directory_`] = targetPath;
		return targetPath;
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
		// Push the branch first
		const pushCmd = `git push --set-upstream origin '${sourceBranch}'`;
		const { exitCode: pushExitCode, stdout: pushStdout, stderr: pushStderr } = await execCommand(pushCmd);
		if (pushExitCode > 0) {
			// Combine stdout and stderr for a comprehensive error message
			const errorMessage = `Failed to push branch '${sourceBranch}' to origin.\nstdout: ${pushStdout}\nstderr: ${pushStderr}`;
			throw new Error(errorMessage);
		}

		// Get user details for assigning the MR
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

	/**
	 * Gets the list of branches for a given GitLab project.
	 * @param projectId The full project path (e.g., 'group/subgroup/project') or the numeric project ID.
	 * @returns A promise that resolves to an array of branch names.
	 */
	@func()
	async getBranches(projectId: string | number): Promise<string[]> {
		try {
			// The Gitbeaker library handles pagination internally for `all()` methods
			const branches: BranchSchema[] = await this.api().Repositories.allBranches(projectId);
			return branches.map((branch) => branch.name);
		} catch (error) {
			logger.error(error, `Failed to get branches for GitLab project ${projectId}`);
			throw new Error(`Failed to get branches for ${projectId}: ${error.message}`);
		}
	}

	/**
	 * Returns the type of this SCM provider.
	 */
	getScmType(): 'gitlab' {
		return 'gitlab';
	}
}
