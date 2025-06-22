import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { appContext } from '#app/applicationContext';
import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import type { SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/agent/agent.model';
import type { CodeTask, CreateCodeTaskData } from '#shared/codeTask/codeTask.model';
import { queryWithFileSelection2 } from '#swe/discovery/selectFilesAgentWithSearch';
import { runCodeTaskWorkflowAgent } from './codeTaskAgentRunner';
import type { CodeTaskRepository } from './codeTaskRepository';
import { getCodeTaskRepositoryPath } from './codeTaskRepositoryPath';

export class CodeTaskCreation {
	constructor(private codeTaskRepo: CodeTaskRepository) {}

	async createCodeTask(userId: string, codeTaskData: CreateCodeTaskData): Promise<CodeTask> {
		logger.info({ userId, title: codeTaskData.title }, '[CodeTaskServiceImpl] Creating codeTask...');
		const codeTaskId = randomUUID();
		const now = Date.now();

		const newCodeTask: CodeTask = {
			...codeTaskData,
			repositoryId: codeTaskData.repositoryFullPath!, // Explicitly set and assert non-null based on upstream logic
			id: codeTaskId,
			userId: userId,
			status: 'initializing',
			createdAt: now,
			updatedAt: now,
			lastAgentActivity: now,
			// Initialize optional fields
			fileSelection: undefined,
			designAnswer: undefined,
			codeDiff: undefined,
			commitSha: undefined,
			pullRequestUrl: undefined,
			error: undefined,
			ciCdProposedFix: undefined,
			ciCdStatus: undefined,
			ciCdJobUrl: undefined,
			ciCdAnalysis: undefined,
			agentHistory: [],
		};

		await this.codeTaskRepo.createCodeTask(newCodeTask);
		logger.info({ codeTaskId, userId }, '[CodeTaskServiceImpl] CodeTask created in repository. Triggering background initialization...');

		// Trigger background initialization asynchronously (fire and forget)
		this._runCodeTaskInitialization(userId, codeTaskId).catch((e) => logger.error(e));

		return { ...newCodeTask }; // Return the codeTask state *at creation*
	}

	/**
	 * Performs the background initialization for a Code task:
	 * 1. Clones/updates the repository.
	 * 2. Checks out the correct branches.
	 * 3. Runs the file selection agent.
	 * 4. Updates the codeTask state in the repository.
	 * This method is designed to run asynchronously and handles its own errors.
	 */
	async _runCodeTaskInitialization(userId: string, codeTaskId: string): Promise<void> {
		let workspacePath: string; // Declare workspacePath here
		let fss: FileSystemService | null = null; // Define fss here to be accessible in finally block if needed

		logger.info({ userId, codeTaskId }, '[CodeTaskServiceImpl] Starting background initialization...');

		// 1. Get CodeTask Data
		const codeTask = await this.codeTaskRepo.getCodeTask(userId, codeTaskId);
		if (!codeTask) {
			logger.error({ userId, codeTaskId }, 'CodeTask not found during background initialization.');
			return;
		}

		try {
			// Ensure user data is available if needed for agent context
			const user = await appContext().userService.getUser(userId);
			if (!user) throw new Error(`User ${userId} not found for Code task ${codeTaskId}`);

			// Ensure the path
			workspacePath = getCodeTaskRepositoryPath(codeTask);
			fss = new FileSystemService(workspacePath);
			await fs.mkdir(workspacePath, { recursive: true });
			fss.setWorkingDirectory(workspacePath);

			// 3. Repository Setup
			logger.info({ codeTaskId }, '[CodeTaskServiceImpl] Starting SCM setup...');

			let scm: SourceControlManagement;
			if (codeTask.repositorySource === 'gitlab') scm = new GitLab();
			if (codeTask.repositorySource === 'github') scm = new GitHub();

			// Clone the project - assumes repositoryId is 'owner/repo' or similar for SCM providers
			if (scm) {
				logger.info(`Cloning project ${codeTask.repositoryName} (${codeTask.repositoryId}) branch: ${codeTask.workingBranch} to ${workspacePath}`);
				const clonedRepoPath = await scm.cloneProject(codeTask.repositoryId, codeTask.workingBranch, workspacePath);
				logger.info(`Repo cloned to ${clonedRepoPath}`);
				// Verify the path returned by cloneProject. Ideally, it matches workspacePath.
				if (clonedRepoPath !== workspacePath) {
					logger.warn(
						{ codeTaskId, clonedRepoPath, expectedPath: workspacePath },
						'Cloned repository path differs from calculated workspace path. Using actual cloned path.',
					);
					// If cloneProject creates a subdirectory (e.g., workspacePath/repoName), clonedRepoPath will be different.
					// We MUST use clonedRepoPath for the FileSystemService.
				} else {
					logger.info({ codeTaskId, clonedRepoPath }, 'Repository cloned/updated into calculated workspace path.');
				}
			} else {
				// Local repository, ensure we are on the correct branch and pull
				await fss.getVcs().switchToBranch(codeTask.targetBranch); // Switch to the base branch
				await fss.getVcs().pull(); // Pull latest changes for the base branch
			}

			// Initialize FileSystemService rooted in the *actual* cloned path

			logger.info({ codeTaskId, repoPath: fss.getWorkingDirectory() }, 'FileSystemService initialized for repository path.');

			// Prepare agent context fragment *after* fss is initialized
			const agentContextFragment: Pick<AgentContext, 'fileSystem' | 'user'> = { fileSystem: fss, user: user };

			// Branch setup
			if (codeTask.createWorkingBranch) {
				logger.info({ codeTaskId, branch: codeTask.workingBranch }, 'Creating and switching to new working branch...');
				await fss.getVcs().createBranch(codeTask.workingBranch);
				await fss.getVcs().switchToBranch(codeTask.workingBranch);
			} else {
				logger.info({ codeTaskId, branch: codeTask.workingBranch }, 'Switching to existing working branch (which is the base branch)...');
				await fss.getVcs().switchToBranch(codeTask.workingBranch);
			}

			logger.info({ codeTaskId }, '[CodeTaskServiceImpl] SCM setup complete.');

			// 4. Run File Selection Agent (reuse the same agent context fragment)
			logger.info({ codeTaskId }, '[CodeTaskServiceImpl] Starting file selection agent...');
		} catch (e) {
			console.log(e);
			logger.error({ codeTaskId, error: e.message }, 'Error during codeTask initialization.');
			await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, { status: 'error', error: `Initialisation failed. ${e.message}` });
			return;
		}
		// Initial design generation
		try {
			await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, { status: 'generating_design' });
			codeTask.status = 'generating_design';

			await runCodeTaskWorkflowAgent(codeTask, 'generateDesign', this.codeTaskRepo, async () => {
				getFileSystem().setWorkingDirectory(workspacePath);
				const { files, answer } = await queryWithFileSelection2(codeTask.instructions);
				logger.info({ codeTaskId, files, design: answer }, 'generateDesign completed.');

				// 5. Update CodeTask State (Success)
				await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, {
					status: 'design_review',
					fileSelection: files,
					designAnswer: answer,
					lastAgentActivity: Date.now(),
					error: null, // Clear any previous error
				});
			});
			logger.info({ codeTaskId }, '[CodeTaskServiceImpl] Background initialization finished successfully.');
		} catch (error: any) {
			// 6. Update CodeTask State (Failure)
			logger.error(error, `[CodeTaskServiceImpl] Background initialization failed for codeTask ${codeTaskId}`);
			try {
				await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, {
					status: 'error',
					error: error instanceof Error ? error.message : 'Background initialization failed',
					lastAgentActivity: Date.now(),
				});
			} catch (updateError) {
				logger.error(updateError, `[CodeTaskServiceImpl] Failed to update codeTask ${codeTaskId} status to error after init failure.`);
			}
			// Do not re-throw, as this is a background task. Error is logged and stored in codeTask.
		}
	}
}
