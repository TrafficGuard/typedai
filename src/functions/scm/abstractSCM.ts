import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { agentContext, getFileSystem } from '#agent/agentContextLocalStorage';
import { agentStorageDir, systemDir } from '#app/appDirs';
import type { MergeRequest, SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/agent/agent.model';
import type { ToolType } from '#shared/agent/functions';
import type { GitProject } from '#shared/scm/git.model';
import { getProjectInfo } from '#swe/projectDetection';
import { execCommand, failOnError } from '#utils/exec';

export abstract class AbstractSCM implements SourceControlManagement {
	async cloneGitProject(projectPathWithNamespace: string, token: string, host: string, branchOrCommit?: string, targetDirectory?: string): Promise<string> {
		if (!projectPathWithNamespace) throw new Error('Parameter "projectPathWithNamespace" must be truthy');

		const fss = getFileSystem();
		const agent: AgentContext | undefined = agentContext();

		let targetPath: string;
		if (targetDirectory) {
			targetPath = targetDirectory;
		} else {
			const scmType = this.getScmType(); // Use a local variable for scmType
			const basePath = !agent || agent.useSharedRepos ? join(systemDir(), scmType) : join(agentStorageDir(), scmType);
			targetPath = join(basePath, projectPathWithNamespace);
		}
		await fs.mkdir(targetPath, { recursive: true });

		// If the project already exists pull updates
		if (existsSync(targetPath) && existsSync(join(targetPath, '.git'))) {
			const currentWorkingDir = fss.getWorkingDirectory();
			try {
				fss.setWorkingDirectory(targetPath);
				logger.info(`${projectPathWithNamespace} exists at ${targetPath}. Configuring remote and pulling updates.`);

				// Ensure remote URL has the token for authentication for fetch/pull
				const remoteSetUrlCommand = `git remote set-url origin https://oauth2:${token}@${host}/${projectPathWithNamespace}.git`;
				const remoteSetUrlResult = await execCommand(remoteSetUrlCommand, { workingDirectory: targetPath, mask: token });
				failOnError(`Failed to set remote URL for ${projectPathWithNamespace}`, remoteSetUrlResult);

				// Determine target branch and switch to it
				// getProjectInfo reads from the local file system, so CWD must be targetPath
				const projectInfo = await getProjectInfo();
				let targetBranchToEnsure: string;

				if (branchOrCommit) {
					targetBranchToEnsure = branchOrCommit;
				} else if (projectInfo?.devBranch) {
					targetBranchToEnsure = projectInfo.devBranch;
				} else {
					// Fetches project details via API to get the default branch
					const gitProject = await this.getProject(projectPathWithNamespace);
					targetBranchToEnsure = gitProject.defaultBranch;
				}

				if (targetBranchToEnsure) {
					logger.info(`Attempting to switch to branch ${targetBranchToEnsure} before pulling updates.`);
					// switchToBranch should handle fetching the branch if it's remote and not yet local,
					// now using the authenticated remote.
					if (await fss.getVcs().isRepoDirty()) {
						logger.info('Stashing changes');
						await fss.getVcs().stashChanges();
					}
					await fss.getVcs().switchToBranch(targetBranchToEnsure);
				} else {
					logger.warn('No specific branch determined for pull. Will attempt to pull the current branch.');
				}

				// Fetch all updates from the remote
				const fetchResult = await execCommand('git fetch', { workingDirectory: targetPath });
				failOnError('Failed to fetch updates', fetchResult);

				if (await fss.getVcs().isRepoDirty()) {
					logger.info('Stashing changes');
					await fss.getVcs().stashChanges();
				}

				// Pull updates for the current branch
				const pullResult = await execCommand('git pull', { workingDirectory: targetPath });
				if (pullResult.stderr?.includes('There is no tracking information for the current branch')) {
					logger.info(pullResult.stderr);
				} else {
					failOnError('Failed to pull updates', pullResult);
				}
			} finally {
				fss.setWorkingDirectory(currentWorkingDir);
			}
		} else {
			logger.info(`Cloning project: ${projectPathWithNamespace} to ${targetPath}`);
			const command = `git clone https://oauth2:${token}@${host}/${projectPathWithNamespace}.git ${targetPath}`;
			const result = await execCommand(command, { mask: token });

			// This error occurs when the default branch on the remote is empty or points to a non-existent ref
			if (result.stderr?.includes('remote HEAD refers to nonexistent ref')) {
				logger.warn(`Remote HEAD for ${projectPathWithNamespace} refers to a nonexistent ref. Attempting to switch to a known branch.`);
				const gitProject = await this.getProject(projectPathWithNamespace);
				const branchToSwitch = branchOrCommit ?? gitProject.defaultBranch;
				if (branchToSwitch) {
					// Need to operate within the newly cloned directory
					const switchCmdResult = await execCommand(`git switch ${branchToSwitch}`, { workingDirectory: targetPath });
					if (switchCmdResult.exitCode === 0) {
						logger.info(`Successfully switched to branch ${branchToSwitch} in ${projectPathWithNamespace}`);
					} else {
						failOnError(
							`Unable to switch to branch ${branchToSwitch} for ${projectPathWithNamespace} after clone with bad remote HEAD. Error: ${switchCmdResult.stderr}`,
							switchCmdResult,
						);
					}
				} else {
					logger.error(`Cannot switch branch for ${projectPathWithNamespace}: no specific branch provided and default branch is unknown.`);
				}
			} else {
				failOnError(`Failed to clone ${projectPathWithNamespace}`, result);
			}
			// If a specific branchOrCommit was requested for a fresh clone, check it out.
			if (branchOrCommit) {
				logger.info(`Switching to specified branch/commit: ${branchOrCommit} after clone.`);
				// Use fss.getVcs().switchToBranch which is more robust.
				// Need to temporarily set CWD for fss.getVcs() if it relies on it.
				const currentWorkingDir = fss.getWorkingDirectory();
				try {
					fss.setWorkingDirectory(targetPath);
					await fss.getVcs().switchToBranch(branchOrCommit);
				} finally {
					fss.setWorkingDirectory(currentWorkingDir);
				}
			}
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
