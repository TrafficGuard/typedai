import { existsSync } from 'fs';
import { join } from 'path';
import { request } from '@octokit/request';
import { agentContext } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { MergeRequest, SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';
import { functionConfig } from '#user/userService/userContext';
import { envVar } from '#utils/env-var';
import { execCommand, failOnError, spawnCommand } from '#utils/exec';
import { systemDir } from '../../appVars';
import { GitProject } from './gitProject';

type RequestType = typeof request;

export interface GitHubConfig {
	username: string;
	organisation: string;
	token: string;
}

/**
 *
 */
@funcClass(__filename)
export class GitHub implements SourceControlManagement {
	/** Do not access. Use request() */
	private _request;
	/** Do not access. Use config() */
	private _config: GitHubConfig;

	config(): GitHubConfig {
		if (!this._config) {
			const userConfig = functionConfig(GitHub) as GitHubConfig;
			this._config = {
				username: userConfig.username || process.env.GITHUB_USER,
				organisation: userConfig.organisation || process.env.GITHUB_ORG,
				token: userConfig.token || envVar('GITHUB_TOKEN'),
			};
			if (!this._config.username && !this._config.organisation) throw new Error('GitHub Org or User must be provided');
			if (!this._config.token) throw new Error('GitHub token must be provided');
		}
		return this._config;
	}

	request(): RequestType {
		if (!this._request) {
			this._request = request.defaults({
				headers: {
					authorization: `token ${this.config().token}`,
				},
			});
		}
		return this._request;
	}

	// Do NOT change this method
	/**
	 * Runs the integration test for the GitHub service class
	 */
	@func()
	async runIntegrationTest(): Promise<string> {
		const result = await execCommand('npm run test:integration');
		failOnError('Test failed', result);
		return result.stdout;
	}

	/**
	 * Clones a GitHub project to the local filesystem at a system controlled location.
	 * To use this project the function FileSystem.setWorkingDirectory must be called after with the returned value.
	 * @param projectPathWithOrg The repo to clone, in the format organisation/project
	 * @returns the file system path where the repository is located
	 */
	@func()
	async cloneProject(projectPathWithOrg: string, branchOrCommit: string): Promise<string> {
		const paths = projectPathWithOrg.split('/');
		if (paths.length !== 2) throw new Error(`${projectPathWithOrg} must be in the format organisation/project`);
		const org = paths[0];
		const project = paths[1];

		const path = join(systemDir(), 'github', org, project);

		// TODO it cloned a project to the main branch when the default is master?
		// If the project already exists pull updates
		if (existsSync(path) && existsSync(join(path, '.git'))) {
			logger.info(`${org}/${project} exists at ${path}. Pulling updates`);
			// If we're resuming an agent which has already created the branch but not pushed
			// then it won't exist remotely, so this will return a non-zero code
			if (branchOrCommit) {
				// Fetch all branches and commits
				await execCommand(`git -C ${path} fetch --all`, { workingDirectory: path });

				// Checkout to the branch or commit
				const result = await execCommand(`git -C ${path} checkout ${branchOrCommit}`, { workingDirectory: path });
				failOnError(`Failed to checkout ${branchOrCommit} in ${path}`, result);

				// if (this.checkIfBranch(branchOrCommit)) {
				// 	const pullResult = await execCommand(`git pull`);
				// 	failOnError(`Failed to pull ${path} after checking out ${branchOrCommit}`, pullResult);
				// }
			}
		} else {
			logger.info(`Cloning project: ${org}/${project} to ${path}`);
			const command = `git clone 'https://oauth2:${this.config().token}@github.com/${projectPathWithOrg}.git' ${path}`;
			const result = await spawnCommand(command);
			// if(result.error) throw result.error
			failOnError(`Failed to clone ${projectPathWithOrg}`, result);

			const checkoutResult = await execCommand(`git -C ${path} checkout ${branchOrCommit}`, { workingDirectory: path });
			failOnError(`Failed to checkout ${branchOrCommit} in ${path}`, checkoutResult);
		}
		const agent = agentContext();
		if (agent) agentContext().memory[`GitHub_project_${org}_${project}_FileSystem_directory`] = path;

		return path;
	}

	async checkIfBranch(ref: string): Promise<boolean> {
		const result = await execCommand(`git show-ref refs/heads/${ref}`);
		if (result.exitCode) return false;
		return result.stdout.trim().length > 0;
	}

	@func()
	async createMergeRequest(title: string, description: string, sourceBranch: string, targetBranch: string): Promise<MergeRequest> {
		// TODO git push

		const originUrl = (await execCommand('git config --get remote.origin.url')).stdout;
		const [owner, repo] = extractOwnerProject(originUrl);

		const response = await this.request()('POST /repos/{owner}/{repo}/pulls', {
			owner,
			repo,
			title: title,
			body: description,
			head: sourceBranch,
			base: targetBranch,
			headers: {
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});
		return {
			id: response.data.id,
			iid: response.data.id,
			url: response.data.url,
			title: response.data.title,
		};
	}

	async getProject(projectId: string | number): Promise<GitProject> {
		try {
			logger.info(`Getting project ${projectId}`);
			const response = await this.request()(`GET /repos/${projectId}`, {
				type: 'all',
				sort: 'updated',
				direction: 'desc',
				per_page: 100,
				headers: {
					'X-GitHub-Api-Version': '2022-11-28',
				},
			});
			return convertGitHubToGitProject(response.data as GitHubRepository);
		} catch (error) {
			logger.error(error, 'Failed to get project');
			throw new Error(`Failed to get project: ${error.message}`);
		}
	}

	@func()
	async getProjects(): Promise<GitProject[]> {
		if (this.config().username) {
			try {
				logger.info(`Getting projects for ${this.config().organisation}`);
				const response = await this.request()('GET /users/{username}/repos', {
					username: this.config().username,
					type: 'all',
					sort: 'updated',
					direction: 'desc',
					per_page: 100,
					headers: {
						'X-GitHub-Api-Version': '2022-11-28',
					},
				});
				return (response.data as GitHubRepository[]).map(convertGitHubToGitProject);
			} catch (error) {
				logger.error(error, 'Failed to get projects');
				throw new Error(`Failed to get projects: ${error.message}`);
			}
		} else if (this.config().organisation) {
			try {
				logger.info(`Getting projects for ${this.config().organisation}`);
				const response = await this.request()('GET /orgs/{org}/repos', {
					org: this.config().organisation,
					type: 'all',
					sort: 'updated',
					direction: 'desc',
					per_page: 100,
					headers: {
						'X-GitHub-Api-Version': '2022-11-28',
					},
				});
				return (response.data as GitHubRepository[]).map(convertGitHubToGitProject);
			} catch (error) {
				logger.error(error, 'Failed to get projects');
				throw new Error(`Failed to get projects: ${error.message}`);
			}
		} else {
			throw new Error('GitHub Org or User must be configured');
		}
	}

	/**
	 * Fetches the logs for a specific job in a GitHub Actions workflow.
	 * @param projectPath The path to the project, typically in the format 'owner/repo'
	 * @param jobId The ID of the job for which to fetch logs
	 * @returns A promise that resolves to the job logs as a string
	 * @throws Error if unable to fetch the job logs
	 */
	@func()
	async getJobLogs(projectPath: string, jobId: string): Promise<string> {
		try {
			const [owner, repo] = extractOwnerProject(projectPath);
			const response = await this.request()('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
				owner,
				repo,
				job_id: Number(jobId),
				headers: {
					Accept: 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
			});
			if (typeof response.data === 'string') return response.data;
			return JSON.stringify(response.data);
		} catch (error) {
			logger.error(`Failed to get job logs for job ${jobId} in project ${projectPath}`, error);
			throw new Error(`Failed to get job logs: ${error.message}`);
		}
	}
}

interface GitHubRepository {
	id: number;
	name: string;
	full_name: string;
	private: boolean;
	html_url: string;
	description: string | null;
	fork: boolean;
	created_at: string;
	updated_at: string;
	pushed_at: string;
	git_url: string;
	ssh_url: string;
	clone_url: string;
	default_branch: string;
	archived: boolean;
}

function convertGitHubToGitProject(repo: GitHubRepository): GitProject {
	return {
		id: repo.id,
		name: repo.name,
		namespace: repo.full_name.split('/')[0],
		fullPath: repo.full_name,
		description: repo.description,
		defaultBranch: repo.default_branch,
		visibility: repo.private ? 'private' : 'public',
		archived: repo.archived ?? false,
	};
}

function extractOwnerProject(url: string): [string, string] {
	// Remove trailing '.git' if present
	const cleanUrl = url.replace(/\.git$/, '');

	// Split the URL by '/' for HTTPS or ':' for SSH formats
	const parts = cleanUrl.split(/\/|:/);

	// The project name is the last part of the segments
	return [parts[parts.length - 2], parts[parts.length - 1]];
}
