import { existsSync } from 'fs';
import fs from 'node:fs';
import { join } from 'path';
import {
	CommitDiffSchema,
	ExpandedMergeRequestSchema,
	Gitlab as GitlabApi,
	MergeRequestDiffSchema,
	MergeRequestDiscussionNotePositionOptions,
	ProjectSchema,
} from '@gitbeaker/rest';
import * as micromatch from 'micromatch';
import { agentContext, getFileSystem, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import { span } from '#o11y/trace';
import { CodeReviewConfig, codeReviewToXml } from '#swe/codeReview/codeReviewModel';
import { getProjectInfo } from '#swe/projectDetection';
import { functionConfig } from '#user/userService/userContext';
import { allSettledAndFulFilled } from '#utils/async-utils';
import { envVar } from '#utils/env-var';
import { execCommand, failOnError, shellEscape } from '#utils/exec';
import { systemDir } from '../../appVars';
import { appContext } from '../../applicationContext';
import { cacheRetry } from '../../cache/cacheRetry';
import { LlmTools } from '../util';
import { GitProject } from './gitProject';
import { SourceControlManagement } from './sourceControlManagement';

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
		const path = join(systemDir(), 'gitlab', projectPathWithNamespace);
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
					await getFileSystem().vcs.switchToBranch(projectInfo.devBranch);
				} else {
					const gitProject = await this.getProject(projectPathWithNamespace);
					const switchResult = await execCommand(`git switch ${gitProject.defaultBranch}`, { workingDirectory: path });
					if (switchResult.exitCode === 0) logger.info(`Switched to branch ${gitProject.defaultBranch}`);
				}

				const result = await execCommand(`git -C ${path} pull`);
				if (result.exitCode !== 0) logger.warn('Failed to pull updates');
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
	 * @param {string} title The title of the merge request
	 * @param {string} description The description of the merge request
	 * @param {string} targetBranch The branch to merge to
	 * @return the merge request URL if available, else null
	 */
	@func()
	async createMergeRequest(title: string, description: string, targetBranch: string): Promise<string | null> {
		// TODO lookup project details from project list
		// get main branch. If starts with feature and dev develop exists, then that
		const currentBranch: string = await getFileSystem().vcs.getBranchName();

		// TODO if the user has changed their gitlab token, then need to update the origin URL with it
		// TODO description -o merge_request.description='${sanitize(description)}' need to remove new line characters
		const cmd = `git push --set-upstream origin '${currentBranch}' -o merge_request.create -o merge_request.target='${targetBranch}' -o merge_request.remove_source_branch -o merge_request.title=${shellEscape(
			title,
		)}`;
		const { exitCode, stdout, stderr } = await execCommand(cmd);
		if (exitCode > 0) throw new Error(`${stdout}\n${stderr}`);
		logger.info(stdout);

		const url = await new LlmTools().processText(stdout, 'Respond only with the URL where the merge request is.');

		if (URL.canParse(url) && url.includes(this.config().host)) {
			// TODO add the current user as a reviewer
			return url;
		}
		return null;
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

	@cacheRetry()
	@span()
	async getDiffs(gitlabProjectId: string | number, mergeRequestIId: number): Promise<MergeRequestDiffSchema[]> {
		return await this.api().MergeRequests.allDiffs(gitlabProjectId, mergeRequestIId, { perPage: 20 });
	}

	@span()
	async reviewMergeRequest(gitlabProjectId: string | number, mergeRequestIId: number): Promise<MergeRequestDiffSchema[]> {
		const mergeRequest: ExpandedMergeRequestSchema = await this.api().MergeRequests.show(gitlabProjectId, mergeRequestIId);
		const diffs: MergeRequestDiffSchema[] = await this.getDiffs(gitlabProjectId, mergeRequestIId);

		const codeReviewConfigs: CodeReviewConfig[] = await appContext().codeReviewService.listCodeReviewConfigs();

		let projectPath: string;
		if (typeof gitlabProjectId === 'number') {
			const project = await this.getProject(gitlabProjectId);
			projectPath = `${project.namespace}/${project.name}`;
		} else {
			projectPath = gitlabProjectId;
		}

		logger.info(`Reviewing "${mergeRequest.title}" at ${mergeRequest.web_url}`);

		const codeReviewsToDo: Array<{ config: CodeReviewConfig; diff: MergeRequestDiffSchema }> = [];

		// Find the code review configurations which are relevant for each diff
		for (const diff of diffs) {
			for (const codeReview of codeReviewConfigs) {
				if (this.applyCodeReview(codeReview, diff, projectPath)) codeReviewsToDo.push({ config: codeReview, diff: diff });
			}
		}

		if (!codeReviewsToDo.length) {
			logger.info('No code review configurations matched the diffs');
			return [];
		}

		const codeReviewSummaries = codeReviewsToDo.map((codeReview) => {
			return { title: codeReview.config.title, file: codeReview.diff.new_path, line: getStartingLineNumber(codeReview.diff.diff) };
		});
		logger.info({ codeReviews: codeReviewSummaries }, `Found ${codeReviewsToDo.length} code reviews to apply to diffs [codeReviews]`);

		const codeReviewActions: Promise<DiffReview>[] = codeReviewsToDo.map((todo) => this.reviewDiff(todo.diff, todo.config));
		let codeReviewResults: DiffReview[] = await allSettledAndFulFilled(codeReviewActions);
		codeReviewResults = codeReviewResults.filter((diffReview) => diffReview !== null);

		for (const diffReview of codeReviewResults) {
			for (const comment of diffReview.comments) {
				logger.info(comment, `Adding review comment to ${diffReview.mrDiff.new_path} for "${diffReview.reviewConfig.title}" [comment, lineNumber]`);
				const position: MergeRequestDiscussionNotePositionOptions = {
					baseSha: mergeRequest.diff_refs.base_sha,
					headSha: mergeRequest.diff_refs.head_sha,
					startSha: mergeRequest.diff_refs.start_sha,
					newPath: diffReview.mrDiff.new_path,
					positionType: 'text',
					newLine: comment.lineNumber.toString(),
				};

				try {
					await this.api().MergeRequestDiscussions.create(gitlabProjectId, mergeRequestIId, comment.comment, { position });
				} catch (e) {
					const message = e.cause?.description || e.message;
					logger.warn(
						{ error: e, comment, errorKey: 'GitLab create code review discussion' },
						`Error creating code review comment for "${diffReview.reviewConfig.title}" to ${diffReview.mrDiff.new_path}. ${message} [error, comment]`,
					);
				}
			}
		}
		return diffs;
	}

	/**
	 * Determine if a particular code review configuration is valid to perform on a diff
	 * @param codeReview
	 * @param diff
	 * @param projectPath
	 */
	applyCodeReview(codeReview: CodeReviewConfig, diff: MergeRequestDiffSchema, projectPath: string): boolean {
		if (!codeReview.enabled) return false;

		if (codeReview.projectPaths.length && !micromatch.isMatch(projectPath, codeReview.projectPaths)) {
			logger.debug(`Project path globs ${codeReview.projectPaths} dont match ${projectPath}`);
			return false;
		}

		const hasMatchingExtension = codeReview.fileExtensions?.include.some((extension) => diff.new_path.endsWith(extension));
		const hasRequiredText = codeReview.requires?.text.some((text) => diff.diff.includes(text));

		return hasMatchingExtension && hasRequiredText;
	}

	/**
	 * Review a diff from a merge request using the code review guidelines configured by the files in resources/codeReview
	 * @param mrDiff
	 * @param codeReview
	 */
	@cacheRetry()
	async reviewDiff(mrDiff: MergeRequestDiffSchema, codeReview: CodeReviewConfig): Promise<DiffReview> {
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
		// diffLines = diffLines.slice(1)
		startingLineNumber -= 1;
		diffLines[0] = lineCommenter(startingLineNumber);

		// Add lines numbers
		for (let i = 1; i < diffLines.length; i++) {
			const line = diffLines[i];
			// Add the line number on blank lines
			if (!line.trim().length) diffLines[i] = lineCommenter(startingLineNumber + i);
			// Could add in a line number at least every 10 lines if the file type supports closing comments i.e. /* */
		}
		const currentCode = diffLines.join(`\n${lineCommenter(startingLineNumber + diffLines.length)}`);

		const prompt = `You are an AI software engineer tasked with reviewing code changes for our software development style standards.

Review Configuration:
${codeReviewToXml(codeReview)}

Code to Review:
<code>
${currentCode}
</code>

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
		// TODO force JSON schema
		const reviewComments = (await llms().medium.generateJson(prompt, { id: 'Diff code review', temperature: 0.5 })) as {
			violations: Array<{ lineNumber: number; comment: string }>;
		};

		if (Array.isArray(!reviewComments?.violations)) {
			logger.warn({ response: reviewComments }, 'Invalid code review [response]');
			return null;
		}

		return { code: currentCode, comments: reviewComments.violations, mrDiff, reviewConfig: codeReview };
	}

	@func()
	async getJobLogs(projectPath: string, jobId: string): Promise<string> {
		if (!projectPath) throw new Error('Parameter "projectPath" must be truthy');
		if (!jobId) throw new Error('Parameter "jobId" must be truthy');

		const project = await this.api().Projects.show(projectPath);
		const job = await this.api().Jobs.show(project.id, jobId);

		return await this.api().Jobs.showLog(project.id, job.id);
	}

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
	return parseInt(diff);
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
