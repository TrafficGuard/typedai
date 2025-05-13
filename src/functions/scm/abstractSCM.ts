import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { agentStorageDir, systemDir } from '#app/appDirs';
import type { MergeRequest, SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/model/agent.model';
import type { GitProject } from '#shared/model/git.model';
import type { ToolType } from '#shared/services/functions';
import { getProjectInfo } from '#swe/projectDetection';
import { execCommand, failOnError } from '#utils/exec';

export abstract class AbstractSCM implements SourceControlManagement {
	async cloneGitProject(projectPathWithNamespace: string, token: string, host: string, branchOrCommit?: string, targetDirectory?: string): Promise<string> {
		if (!projectPathWithNamespace) throw new Error('Parameter "projectPathWithNamespace" must be truthy');

		const fss = getFileSystem();
		const agent: AgentContext | null = agentContext();

		let targetPath: string;
		if (targetDirectory) {
			targetPath = targetDirectory;
		} else {
			const basePath = agent.useSharedRepos ? join(systemDir(), this.getScmType()) : join(agentStorageDir(), this.getScmType());
			targetPath = targetDirectory ?? join(basePath, projectPathWithNamespace);
		}
		await fs.mkdir(targetPath, { recursive: true });

		// If the project already exists pull updates from the main/dev branch
		if (existsSync(targetPath) && existsSync(join(targetPath, '.git'))) {
			const currentWorkingDir = fss.getWorkingDirectory();
			try {
				fss.setWorkingDirectory(targetPath);
				logger.info(`${projectPathWithNamespace} exists at ${targetPath}. Pulling updates`);

				// If the repo has a projectInfo.json file with a devBranch defined, then switch to that
				// else switch to the default branch defined in the GitLab project
				const projectInfo = await getProjectInfo();
				if (branchOrCommit) {
					await fss.getVcs().switchToBranch(branchOrCommit);
				} else if (projectInfo.devBranch) {
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
			const command = `git clone https://oauth2:${token}@${host}/${projectPathWithNamespace}.git ${targetPath}`;
			const result = await execCommand(command, { mask: token });

			if (result.stderr?.includes('remote HEAD refers to nonexistent ref')) {
				const gitProject = await this.getProject(projectPathWithNamespace);
				const branch = branchOrCommit ?? gitProject.defaultBranch;
				const switchResult = await execCommand(`git switch ${branch}`, { workingDirectory: targetPath });
				if (switchResult.exitCode === 0) logger.info(`Switched to branch ${branch}`);
				failOnError(`Unable to switch to branch ${branch} for ${projectPathWithNamespace}`, switchResult);
			}

			failOnError(`Failed to clone ${projectPathWithNamespace}`, result);
		}
		if (agent) agent.memory[`${this.getScmType()} Repo: ${projectPathWithNamespace} FileSystem location`] = targetPath;

		return targetPath;
	}

	getToolType(): ToolType {
		return 'scm';
	}

	abstract cloneProject(projectPathWithNamespace: string, branchOrCommit?: string, targetDirectory?: string): Promise<string>;

	abstract createMergeRequest(
		projectId: string | number,
		title: string,
		description: string,
		sourceBranch: string,
		targetBranch: string,
	): Promise<MergeRequest>;

	abstract getBranches(projectId: string | number): Promise<string[]>;

	abstract getJobLogs(projectPath: string, jobId: string): Promise<string>;

	abstract getProject(projectId: string | number): Promise<GitProject>;

	abstract getProjects(): Promise<GitProject[]>;

	abstract getScmType(): string;

	abstract isConfigured(): boolean;
}
