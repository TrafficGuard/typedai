import { request } from '@octokit/request';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { AbstractSCM } from '#functions/scm/abstractSCM';
import type { MergeRequest, SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';
import type { GitProject } from '#shared/scm/git.model';
import { functionConfig } from '#user/userContext';
import { envVar } from '#utils/env-var';
import { execCommand, failOnError } from '#utils/exec';
import { extractOwnerProject } from './scmUtils';

type RequestType = typeof request;

export interface GitHubConfig {
	username: string;
	organisation: string;
	token: string;
}

export interface GitHubIssue {
	id: number;
	number: number; // Issue number in the repository
	url: string; // HTML URL to the issue
	apiUrl: string; // API URL for the issue
	title: string;
	state: string; // e.g., "open", "closed"
}

export interface GitHubIssueComment {
	id: number;
	html_url: string; // HTML URL to the comment
	body: string;
	user: {
		// Basic user information
		login: string;
		id: number;
	} | null; // User can be null for some system-generated comments
	created_at: string;
	updated_at: string;
}

/**
 *
 */
@funcClass(__filename)
export class GitHub extends AbstractSCM implements SourceControlManagement {
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

	/**
	 * Checks if the GitHub configuration (token and username/organisation) is available.
	 * @returns {boolean} True if configured, false otherwise.
	 */
	isConfigured(): boolean {
		const userConfig = functionConfig(GitHub) as GitHubConfig;
		const token = userConfig?.token || process.env.GITHUB_TOKEN;
		const user = userConfig?.username || process.env.GITHUB_USER;
		const org = userConfig?.organisation || process.env.GITHUB_ORG;

		return !!(token && (user || org));
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
	 * Creates an issue in a GitHub repository.
	 * @param projectPathWithNamespace The full path of the project, e.g., 'owner/repo'.
	 * @param title The title of the issue.
	 * @param body Optional description for the issue.
	 * @param labels Optional array of labels to add to the issue.
	 * @param assignees Optional array of GitHub usernames to assign to the issue.
	 * @returns A promise that resolves to the created GitHubIssue object.
	 */
	@func()
	async createIssue(projectPathWithNamespace: string, title: string, body?: string, labels?: string[], assignees?: string[]): Promise<GitHubIssue> {
		try {
			const [owner, repo] = extractOwnerProject(projectPathWithNamespace);

			const requestPayload: {
				title: string;
				body?: string;
				labels?: string[];
				assignees?: string[];
			} = { title };

			if (body) {
				requestPayload.body = body;
			}
			if (labels && labels.length > 0) {
				requestPayload.labels = labels;
			}
			if (assignees && assignees.length > 0) {
				requestPayload.assignees = assignees;
			}

			const response = await this.request()('POST /repos/{owner}/{repo}/issues', {
				owner,
				repo,
				...requestPayload,
				headers: {
					'X-GitHub-Api-Version': '2022-11-28',
				},
			});

			return {
				id: response.data.id,
				number: response.data.number,
				url: response.data.html_url,
				apiUrl: response.data.url,
				title: response.data.title,
				state: response.data.state,
			};
		} catch (error: any) {
			logger.error(error, `Failed to create issue for ${projectPathWithNamespace} with title "${title}"`);
			throw new Error(`Failed to create GitHub issue in '${projectPathWithNamespace}': ${error.message || error}`);
		}
	}

	/**
	 * Posts a comment on a GitHub issue.
	 * @param projectPathWithNamespace The full path of the project, e.g., 'owner/repo'.
	 * @param issueNumber The number of the issue to comment on.
	 * @param body The content of the comment.
	 * @returns A promise that resolves to the created GitHubIssueComment object.
	 */
	@func()
	async postCommentOnIssue(projectPathWithNamespace: string, issueNumber: number, body: string): Promise<GitHubIssueComment> {
		try {
			const [owner, repo] = extractOwnerProject(projectPathWithNamespace);

			const requestPayload = { body };

			const response = await this.request()('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
				owner,
				repo,
				issue_number: issueNumber,
				...requestPayload,
				headers: {
					'X-GitHub-Api-Version': '2022-11-28',
					Accept: 'application/vnd.github.v3+json',
				},
			});

			return {
				id: response.data.id,
				html_url: response.data.html_url,
				body: response.data.body,
				user: response.data.user ? { login: response.data.user.login, id: response.data.user.id } : null,
				created_at: response.data.created_at,
				updated_at: response.data.updated_at,
			};
		} catch (error: any) {
			logger.error(error, `Failed to post comment on issue #${issueNumber} in ${projectPathWithNamespace}`);
			throw new Error(`Failed to post GitHub comment on issue #${issueNumber} in '${projectPathWithNamespace}': ${error.message || error}`);
		}
	}

	/**
	 * Gets all comments for a specific GitHub issue.
	 * @param projectPathWithNamespace The full path of the project, e.g., 'owner/repo'.
	 * @param issueNumber The number of the issue to get comments for.
	 * @returns A promise that resolves to an array of GitHubIssueComment objects.
	 */
	@func()
	async getIssueComments(projectPathWithNamespace: string, issueNumber: number): Promise<GitHubIssueComment[]> {
		try {
			const [owner, repo] = extractOwnerProject(projectPathWithNamespace);
			const allComments: GitHubIssueComment[] = [];
			let page = 1;
			let response: any;

			do {
				response = await this.request()('GET /repos/{owner}/{repo}/issues/{issue_number}/comments', {
					owner,
					repo,
					issue_number: issueNumber,
					per_page: 100,
					page,
					headers: {
						'X-GitHub-Api-Version': '2022-11-28',
						Accept: 'application/vnd.github.v3+json',
					},
				});

				const rawComments = response.data as any[];
				for (const rawComment of rawComments) {
					const comment: GitHubIssueComment = {
						id: rawComment.id,
						html_url: rawComment.html_url,
						body: rawComment.body,
						user: rawComment.user ? { login: rawComment.user.login, id: rawComment.user.id } : null,
						created_at: rawComment.created_at,
						updated_at: rawComment.updated_at,
					};
					allComments.push(comment);
				}
				page++;
			} while (response.headers.link?.includes('rel="next"'));

			return allComments;
		} catch (error: any) {
			logger.error(error, `Failed to get comments for issue #${issueNumber} in ${projectPathWithNamespace}`);
			throw new Error(`Failed to get GitHub comments for issue #${issueNumber} in '${projectPathWithNamespace}': ${error.message || error}`);
		}
	}

	/**
	 * Clones a project from GitHub to the file system.
	 * To use this project the function FileSystem.setWorkingDirectory must be called after with the returned value
	 * @param projectPathWithNamespace the full project path in GitLab
	 * @returns the file system path where the repository is located. You will need to call FileSystem_setWorkingDirectory() with this result to work with the project.
	 */
	@func()
	async cloneProject(projectPathWithNamespace: string, branchOrCommit?: string, targetDirectory?: string): Promise<string> {
		return await this.cloneGitProject(projectPathWithNamespace, this.config().token, 'github.com', branchOrCommit, targetDirectory);
	}

	async checkIfBranch(ref: string): Promise<boolean> {
		const result = await execCommand(`git show-ref refs/heads/${ref}`);
		if (result.exitCode) return false;
		return result.stdout.trim().length > 0;
	}

	/**
	 * Creates a Pull Request
	 * @param title
	 * @param description
	 * @param sourceBranch
	 * @param targetBranch
	 * @returns the MergeRequest details
	 */
	@func()
	async createMergeRequest(title: string, description: string, sourceBranch: string, targetBranch: string): Promise<MergeRequest> {
		// Push the branch first
		const pushCmd = `git push --set-upstream origin '${sourceBranch}'`;
		const { exitCode: pushExitCode, stdout: pushStdout, stderr: pushStderr } = await execCommand(pushCmd);
		if (pushExitCode > 0) {
			// Combine stdout and stderr for a comprehensive error message
			const errorMessage = `Failed to push branch '${sourceBranch}' to origin.\nstdout: ${pushStdout}\nstderr: ${pushStderr}`;
			throw new Error(errorMessage);
		}

		// Determine owner and repo from the origin URL
		const originUrlResult = await execCommand('git config --get remote.origin.url');
		failOnError('Failed to get remote origin URL', originUrlResult);
		const [owner, repo] = extractOwnerProject(originUrlResult.stdout);

		// Create the pull request via GitHub API
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

	/**
	 * Get a project details
	 * @param projectId
	 * @return the GitProject
	 */
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

	/**
	 * @returns the projects available for the account
	 */
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
	 * Gets the list of branches for a given GitHub repository.
	 * @param projectId The project identifier, either as 'owner/repo' string or the numeric repository ID as a string or number.
	 * @returns A promise that resolves to an array of branch names.
	 */
	@func()
	async getBranches(projectId: string | number): Promise<string[]> {
		const isNumericId = /^\d+$/.test(String(projectId));
		let owner: string | undefined;
		let repo: string | undefined;
		let repositoryId: number | undefined;

		if (isNumericId) {
			repositoryId = Number(projectId);
			logger.info(`Fetching branches for GitHub repository ID: ${repositoryId}`);
		} else {
			try {
				[owner, repo] = extractOwnerProject(String(projectId));
				logger.info(`Fetching branches for GitHub repository: ${owner}/${repo}`);
			} catch (error) {
				logger.error(error, `Invalid projectId format: ${projectId}. Must be 'owner/repo' or a numeric ID.`);
				throw new Error(`Invalid projectId format: ${projectId}. Must be 'owner/repo' or a numeric ID.`);
			}
		}

		try {
			const branches: { name: string }[] = [];
			let page = 1;
			// Define the type for the response object. Using 'any' because the dynamic endpoint
			// string prevents precise static type inference by Octokit's request function.
			let response: any;

			// Common request parameters
			const commonParams = {
				per_page: 100, // Max per page
				headers: {
					'X-GitHub-Api-Version': '2022-11-28',
				},
			};

			// GitHub API supports getting branches by repository ID directly
			// See: https://docs.github.com/en/rest/branches/branches?apiVersion=2022-11-28#list-branches
			const endpoint = isNumericId ? 'GET /repositories/{repository_id}/branches' : 'GET /repos/{owner}/{repo}/branches';

			do {
				const requestParams: any = {
					...commonParams,
					page,
				};
				if (isNumericId) {
					requestParams.repository_id = repositoryId;
				} else {
					requestParams.owner = owner;
					requestParams.repo = repo;
				}

				response = await this.request()(endpoint, requestParams);

				// Type assertion to help TypeScript understand the response data structure
				const responseData = response.data as { name: string }[];
				branches.push(...responseData);
				page++;
			} while (response.headers.link?.includes('rel="next"')); // Check for pagination link

			return branches.map((branch) => branch.name);
		} catch (error) {
			const idForError = isNumericId ? `ID ${repositoryId}` : `${owner}/${repo}`;
			logger.error(error, `Failed to get branches for GitHub project ${idForError}`);
			// Check for 404 specifically
			if (error.status === 404) {
				throw new Error(`GitHub project ${idForError} not found or access denied.`);
			}
			throw new Error(`Failed to get branches for ${idForError}: ${error.message}`);
		}
	}

	/**
	 * Runs an E2E test for creating an issue in a GitHub repository.
	 * This method will attempt to create a real issue in a pre-defined test repository.
	 * @returns A promise that resolves to the created GitHubIssue object.
	 */
	@func()
	async testCreateIssueE2E(): Promise<GitHubIssue> {
		const projectPathWithNamespace = 'trafficguard/test';
		const title = 'E2E Test: New Issue via Agent';
		const body = 'This issue was created by an automated E2E test. If you see this, the test was successful.';
		const labels = ['e2e-test', 'automated'];

		try {
			logger.info(`Attempting to create E2E test issue in repository '${projectPathWithNamespace}' with title '${title}'`);
			const createdIssue = await this.createIssue(projectPathWithNamespace, title, body, labels);

			logger.info(
				`Successfully created E2E test issue: #${createdIssue.number} - '${createdIssue.title}' in '${projectPathWithNamespace}'. URL: ${createdIssue.url}`,
			);

			if (!createdIssue || createdIssue.title !== title || createdIssue.state !== 'open') {
				const errorMsg = `E2E Test Failed: Issue creation result did not match expectations. Result: ${JSON.stringify(createdIssue)}`;
				logger.error(errorMsg);
				throw new Error(errorMsg);
			}
			logger.info('E2E Test: createIssue verification passed (title and state).');

			return createdIssue;
		} catch (error: any) {
			logger.error(error, `E2E test 'testCreateIssueE2E' failed for project '${projectPathWithNamespace}'`);
			throw new Error(`E2E test 'testCreateIssueE2E' failed: ${error.message || error}`);
		}
	}

	/**
	 * Returns the type of this SCM provider.
	 */
	getScmType(): string {
		return 'github';
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
		type: 'github',
		host: 'github.com',
	};
}
