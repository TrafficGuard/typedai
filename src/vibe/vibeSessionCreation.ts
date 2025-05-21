import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { getFileSystem } from '#agent/agentContextLocalStorage';
import { appContext } from '#app/applicationContext';
import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import type { SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/model/agent.model';
import type { SelectedFile } from '#shared/model/files.model';
import type { CreateVibeSessionData, VibeSession } from '#shared/model/vibe.model';
import { selectFilesAgent } from '#swe/discovery/selectFilesAgentWithSearch';
import { runVibeWorkflowAgent } from '#vibe/vibeAgentRunner';
import type { VibeRepository } from '#vibe/vibeRepository';
import { getVibeRepositoryPath } from '#vibe/vibeRepositoryPath';

export class VibeSessionCreation {
	constructor(private vibeRepo: VibeRepository) {}

	async createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession> {
		logger.info({ userId, title: sessionData.title }, '[VibeServiceImpl] Creating session...');
		const sessionId = randomUUID();
		const now = Date.now();

		const newSession: VibeSession = {
			...sessionData,
			repositoryId: sessionData.repositoryId!, // Explicitly set and assert non-null based on upstream logic
			id: sessionId,
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
			error: null,
			ciCdProposedFix: undefined,
			ciCdStatus: undefined,
			ciCdJobUrl: undefined,
			ciCdAnalysis: undefined,
			agentHistory: [],
		};

		await this.vibeRepo.createVibeSession(newSession);
		logger.info({ sessionId, userId }, '[VibeServiceImpl] Session created in repository. Triggering background initialization...');

		// Trigger background initialization asynchronously (fire and forget)
		this._runSessionInitialization(userId, sessionId); // No await, runs in background

		return { ...newSession }; // Return the session state *at creation*
	}

	/**
	 * Performs the background initialization for a Vibe session:
	 * 1. Clones/updates the repository.
	 * 2. Checks out the correct branches.
	 * 3. Runs the file selection agent.
	 * 4. Updates the session state in the repository.
	 * This method is designed to run asynchronously and handles its own errors.
	 */
	async _runSessionInitialization(userId: string, sessionId: string): Promise<void> {
		let workspacePath: string; // Declare workspacePath here
		let fss: FileSystemService | null = null; // Define fss here to be accessible in finally block if needed

		logger.info({ userId, sessionId }, '[VibeServiceImpl] Starting background initialization...');

		// 1. Get Session Data
		const session = await this.vibeRepo.getVibeSession(userId, sessionId);
		if (!session) {
			// Session might have been deleted between creation and this point
			logger.warn({ userId, sessionId }, 'VibeSession not found during background initialization.');
			return; // Exit gracefully
		}

		try {
			// Ensure user data is available if needed for agent context
			const user = await appContext().userService.getUser(userId);
			if (!user) throw new Error(`User ${userId} not found for Vibe session ${sessionId}`);

			// Ensure the path
			workspacePath = getVibeRepositoryPath(session);
			fss = new FileSystemService(workspacePath);
			await fs.mkdir(workspacePath, { recursive: true });
			fss.setWorkingDirectory(workspacePath);

			// 3. Repository Setup
			logger.info({ sessionId }, '[VibeServiceImpl] Starting SCM setup...');

			let scm: SourceControlManagement;
			if (session.repositorySource === 'gitlab') scm = new GitLab();
			if (session.repositorySource === 'github') scm = new GitHub();

			// Clone the project - assumes repositoryId is 'owner/repo' or similar for SCM providers
			if (scm) {
				logger.info(`Cloning project ${session.repositoryName} (${session.repositoryId}) branch: ${session.workingBranch} to ${workspacePath}`);
				const clonedRepoPath = await scm.cloneProject(session.repositoryId, session.workingBranch, workspacePath);
				logger.info(`Repo cloned to ${clonedRepoPath}`);
				// Verify the path returned by cloneProject. Ideally, it matches workspacePath.
				if (clonedRepoPath !== workspacePath) {
					logger.warn(
						{ sessionId, clonedRepoPath, expectedPath: workspacePath },
						'Cloned repository path differs from calculated workspace path. Using actual cloned path.',
					);
					// If cloneProject creates a subdirectory (e.g., workspacePath/repoName), clonedRepoPath will be different.
					// We MUST use clonedRepoPath for the FileSystemService.
				} else {
					logger.info(
						{
							sessionId,
							clonedRepoPath,
						},
						'Repository cloned/updated into calculated workspace path.',
					);
				}
			} else {
				// Local repository, ensure we are on the correct branch and pull
				await fss.getVcs().switchToBranch(session.targetBranch); // Switch to the base branch
				await fss.getVcs().pull(); // Pull latest changes for the base branch
			}

			// Initialize FileSystemService rooted in the *actual* cloned path

			logger.info(
				{
					sessionId,
					repoPath: fss.getWorkingDirectory(),
				},
				'FileSystemService initialized for repository path.',
			);

			// Prepare agent context fragment *after* fss is initialized
			const agentContextFragment: Pick<AgentContext, 'fileSystem' | 'user'> = {
				fileSystem: fss,
				user: user,
			};

			// Branch setup
			if (session.createWorkingBranch) {
				logger.info({ sessionId, branch: session.workingBranch }, 'Creating and switching to new working branch...');
				await fss.getVcs().createBranch(session.workingBranch);
				await fss.getVcs().switchToBranch(session.workingBranch);
			} else {
				logger.info({ sessionId, branch: session.workingBranch }, 'Switching to existing working branch (which is the base branch)...');
				await fss.getVcs().switchToBranch(session.workingBranch);
			}

			logger.info({ sessionId }, '[VibeServiceImpl] SCM setup complete.');

			// 4. Run File Selection Agent (reuse the same agent context fragment)
			logger.info({ sessionId }, '[VibeServiceImpl] Starting file selection agent...');
		} catch (e) {
			console.log(e);
			logger.error({ sessionId, error: e.message }, 'Error during session initialization.');
			await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'error', error: `Initialisation failed. ${e.message}` });
			return;
		}
		// Initial file selection
		try {
			await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'updating_file_selection' });
			session.status = 'updating_file_selection';

			await runVibeWorkflowAgent(session, 'selectFiles', this.vibeRepo, async () => {
				getFileSystem().setWorkingDirectory(workspacePath);
				const fileSelection: SelectedFile[] = await selectFilesAgent(session.instructions);
				logger.info({ sessionId, fileCount: fileSelection?.length }, 'selectFilesAgent completed.');

				if (!fileSelection || !Array.isArray(fileSelection)) throw new Error('Invalid response structure from selectFilesAgent');

				// 5. Update Session State (Success)
				await this.vibeRepo.updateVibeSession(userId, sessionId, {
					status: 'file_selection_review',
					fileSelection: fileSelection,
					lastAgentActivity: Date.now(),
					error: null, // Clear any previous error
				});
			});
			logger.info({ sessionId }, '[VibeServiceImpl] Background initialization finished successfully.');
		} catch (error: any) {
			// 6. Update Session State (Failure)
			logger.error(error, `[VibeServiceImpl] Background initialization failed for session ${sessionId}`);
			try {
				// Determine a more specific error status if possible
				let errorStatus: VibeSession['status'] = 'error';
				if (error.message?.includes('repositorySource') || error.message?.includes('repositoryId format')) {
					errorStatus = 'error'; // Or potentially a new status like 'error_configuration'
				} else if (error.message?.includes('SCM') || error.message?.includes('clone') || error.message?.includes('branch')) {
					// Keep existing SCM error logic
					errorStatus = 'error'; // Or a specific SCM error status
				} else if (error.message?.includes('selectFilesAgent')) {
					errorStatus = 'error_file_selection';
				}

				await this.vibeRepo.updateVibeSession(userId, sessionId, {
					status: 'error_file_selection',
					error: error instanceof Error ? error.message : 'Background initialization failed',
					lastAgentActivity: Date.now(),
				});
			} catch (updateError) {
				logger.error(updateError, `[VibeServiceImpl] Failed to update session ${sessionId} status to error after init failure.`);
			}
			// Do not re-throw, as this is a background task. Error is logged and stored in session.
		}
	}
}
