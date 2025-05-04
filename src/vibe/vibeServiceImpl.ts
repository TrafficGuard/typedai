import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { agentContextStorage } from '#agent/agentContextLocalStorage';
import type { AgentContext } from '#agent/agentContextTypes';
import { appContext } from '#app/applicationContext';
import type { SourceControlManagement } from '#functions/scm/sourceControlManagement';
import { getSourceControlManagementTool } from '#functions/scm/sourceControlManagement';
import type { VersionControlSystem } from '#functions/scm/versionControlSystem';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import { selectFilesAgent } from '#swe/discovery/selectFilesAgent';
import type { VibeRepository } from '#vibe/vibeRepository';
import type { VibeService } from '#vibe/vibeService';
import type {
	CommitChangesData,
	CreateVibeSessionData,
	DesignAnswer,
	FileSystemNode,
	SelectedFile,
	UpdateCodeReviewData,
	UpdateDesignInstructionsData,
	UpdateVibeSessionData,
	VibePreset,
	VibeSession,
} from '#vibe/vibeTypes';

/**
 * Main implementation of the VibeService.
 * Orchestrates the Vibe workflow, interacting with SCM, agents, filesystem,
 * and the VibeRepository for persistence.
 */
export class VibeServiceImpl implements VibeService {
	constructor(private vibeRepo: VibeRepository) {}

	// --- Session CRUD (Delegated to Repository) ---

	async createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession> {
		logger.info({ userId, title: sessionData.title }, '[VibeServiceImpl] Creating session...');
		const sessionId = randomUUID();
		const now = Date.now();

		const newSession: VibeSession = {
			...sessionData,
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
			// Ensure user object is included if needed by agent context later
			// user: await appContext().userService.getUser(userId), // Example: Fetch user if needed
		};

		await this.vibeRepo.createVibeSession(newSession);
		logger.info({ sessionId, userId }, '[VibeServiceImpl] Session created in repository. Triggering background initialization...');

		// Trigger background initialization asynchronously (fire and forget)
		this.triggerBackgroundInitialization(userId, sessionId); // No await, runs in background

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
	private async triggerBackgroundInitialization(userId: string, sessionId: string): Promise<void> {
		// Determine workspace path relative to a base Vibe workspace directory
		// TODO: Make the base path configurable ('./vibe-workspaces' is just an example)
		const baseWorkspaceDir = join(process.cwd(), 'vibe-workspaces'); // Or use systemDir() etc.
		const workspacePath = join(baseWorkspaceDir, userId, sessionId);
		let fss: FileSystemService | null = null; // Define fss here to be accessible in finally block if needed

		try {
			logger.info({ userId, sessionId, workspacePath }, '[VibeServiceImpl] Starting background initialization...');

			// 1. Get Session Data
			const session = await this.vibeRepo.getVibeSession(userId, sessionId);
			if (!session) {
				// Session might have been deleted between creation and this point
				logger.warn({ userId, sessionId }, 'VibeSession not found during background initialization.');
				return; // Exit gracefully
			}
			// Ensure user data is available if needed for agent context
			const user = await appContext().userService.getUser(userId);
			if (!user) throw new Error(`User ${userId} not found for Vibe session ${sessionId}`);

			// 2. Ensure Workspace Directory Exists
			await fs.mkdir(workspacePath, { recursive: true });
			fss = new FileSystemService(workspacePath); // Filesystem rooted in the specific session workspace

			// 3. SCM Setup (within an agent context scope for filesystem access)
			logger.info({ sessionId }, '[VibeServiceImpl] Starting SCM setup...');
			const agentContextFragment: Pick<AgentContext, 'fileSystem' | 'user'> = {
				fileSystem: fss,
				user: user,
			};

			let clonedRepoPath: string;
			await agentContextStorage.run(agentContextFragment as AgentContext, async () => {
				const scm = await getSourceControlManagementTool();
				if (!scm.isConfigured()) throw new Error(`SCM provider (${scm.getScmType()}) is not configured. Cannot clone repository.`);

				// Clone the project - assumes repositoryId is 'owner/repo' or similar
				// cloneProject should ideally use the agentContext's fileSystem basePath
				clonedRepoPath = await scm.cloneProject(session.repositoryId, session.targetBranch);
				logger.info({ sessionId, clonedRepoPath }, 'Repository cloned/updated.');

				// Set the filesystem's working directory to the actual cloned path
				fss.setWorkingDirectory(clonedRepoPath);
				logger.info({ sessionId, newWd: fss.getWorkingDirectory() }, 'Filesystem working directory set.');

				const vcs: VersionControlSystem = fss.vcs;
				// Checkout branches
				// Ensure we are on targetBranch first (clone might leave us there, but be explicit)
				await vcs.switchToBranch(session.targetBranch);

				if (session.createWorkingBranch) {
					logger.info({ sessionId, branch: session.workingBranch }, 'Creating working branch...');
					await vcs.createBranch(session.workingBranch); // Assumes branching from current HEAD (targetBranch)
				}
				logger.info({ sessionId, branch: session.workingBranch }, 'Switching to working branch...');
				await vcs.switchToBranch(session.workingBranch);

				logger.info({ sessionId }, '[VibeServiceImpl] SCM setup complete.');

				// 4. Run File Selection Agent (reuse the same agent context fragment)
				logger.info({ sessionId }, '[VibeServiceImpl] Starting file selection agent...');

				// Working directory is already set to the repo path within fss
				logger.info({ sessionId, workspacePath: fss.getWorkingDirectory() }, 'Agent context running for file selection.');
				// selectFilesAgent expects UserContentExt, pass instructions directly
				const selection = await selectFilesAgent(session.instructions);
				logger.info({ sessionId, fileCount: selection?.length }, 'selectFilesAgent completed.');

				if (!selection || !Array.isArray(selection)) {
					throw new Error('Invalid response structure from selectFilesAgent');
				}
				// Map the result from selectFilesAgent's SelectedFile to Vibe's SelectedFile
				const fileSelectionResult = selection.map((sf) => ({
					filePath: sf.path, // Map 'path' to 'filePath'
					reason: sf.reason,
					category: sf.category,
					readOnly: sf.readonly, // Map 'readonly' to 'readOnly'
				}));

				// 5. Update Session State (Success)
				await this.vibeRepo.updateVibeSession(userId, sessionId, {
					status: 'file_selection_review',
					fileSelection: fileSelectionResult,
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
				if (error.message?.includes('selectFilesAgent')) {
					errorStatus = 'error_file_selection';
				} else if (error.message?.includes('SCM') || error.message?.includes('clone') || error.message?.includes('branch')) {
					// Assuming SCM errors happen before agent runs
					errorStatus = 'error'; // Or a more specific SCM error status if defined
				}

				await this.vibeRepo.updateVibeSession(userId, sessionId, {
					status: errorStatus,
					error: error instanceof Error ? error.message : 'Background initialization failed',
					lastAgentActivity: Date.now(),
				});
			} catch (updateError) {
				logger.error(updateError, `[VibeServiceImpl] Failed to update session ${sessionId} status to error after init failure.`);
			}
			// Do not re-throw, as this is a background task. Error is logged and stored in session.
		}
	}

	async getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		logger.debug({ userId, sessionId }, '[VibeServiceImpl] Getting session...');
		// Authorization might be checked here or rely on repository/user context
		return this.vibeRepo.getVibeSession(userId, sessionId);
	}

	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		logger.debug({ userId }, '[VibeServiceImpl] Listing sessions...');
		return this.vibeRepo.listVibeSessions(userId);
	}

	async updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		logger.debug({ userId, sessionId, updates }, '[VibeServiceImpl] Updating session...');
		// Add validation or business logic before updating if needed
		await this.vibeRepo.updateVibeSession(userId, sessionId, updates);
	}

	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		logger.info({ userId, sessionId }, '[VibeServiceImpl] Deleting session...');
		// TODO: Implement workspace cleanup logic (e.g., delete cloned repo directory)
		logger.info({ sessionId }, '[VibeServiceImpl] Cleaning up workspace (placeholder)...');
		await this.vibeRepo.deleteVibeSession(userId, sessionId);
		logger.info({ sessionId }, '[VibeServiceImpl] Session deleted from repository.');
	}

	// --- Preset CRUD (Delegated to Repository) ---

	async saveVibePreset(userId: string, name: string, config: Omit<CreateVibeSessionData, 'title' | 'instructions'>): Promise<VibePreset> {
		logger.info({ userId, name }, '[VibeServiceImpl] Saving preset...');
		const presetId = randomUUID();
		const now = Date.now();
		const newPreset: VibePreset = {
			id: presetId,
			userId: userId,
			name: name,
			config: config,
			createdAt: now,
			updatedAt: now,
		};
		await this.vibeRepo.saveVibePreset(newPreset);
		return { ...newPreset };
	}

	async listVibePresets(userId: string): Promise<VibePreset[]> {
		logger.debug({ userId }, '[VibeServiceImpl] Listing presets...');
		return this.vibeRepo.listVibePresets(userId);
	}

	async deleteVibePreset(userId: string, presetId: string): Promise<void> {
		logger.info({ userId, presetId }, '[VibeServiceImpl] Deleting preset...');
		await this.vibeRepo.deleteVibePreset(userId, presetId);
	}

	// --- Workflow Orchestration Actions (Placeholders - Need Implementation) ---

	async updateSelectionWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void> {
		logger.info({ userId, sessionId, prompt }, '[VibeServiceImpl] updateSelectionWithPrompt called');
		try {
			// 1. Get session & validate
			logger.debug({ userId, sessionId }, '[VibeServiceImpl] Getting session for selection update...');
			const session = await this.vibeRepo.getVibeSession(userId, sessionId);
			if (!session) {
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}
			if (session.userId !== userId) {
				// This check might be redundant if the repository enforces user scope, but good practice
				throw new Error('User not authorized for this session.');
			}
			if (session.status !== 'file_selection_review') {
				throw new Error(`Invalid session status: Cannot update selection in current state '${session.status}'. Expected 'file_selection_review'.`);
			}

			// 2. Update status to 'updating_selection' in repo
			logger.info({ sessionId }, '[VibeServiceImpl] Updating session status to updating_selection...');
			await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'updating_selection', lastAgentActivity: Date.now() });

			// 3. Trigger agent asynchronously
			// TODO: Trigger runSelectFilesAgent asynchronously with session details and prompt.
			// The agent's callback/result handler would then update the repo with the new
			// fileSelection and set the status back to 'file_selection_review' or 'error_file_selection'.
			logger.warn({ sessionId }, '[VibeServiceImpl] Agent triggering for updateSelectionWithPrompt is not implemented.');

			// Placeholder for async agent call simulation (remove when agent is integrated)
			// Simulating a delay and potential error for now
			// await new Promise(resolve => setTimeout(resolve, 1500));
			// logger.info({ sessionId }, "[VibeServiceImpl] Placeholder agent call finished.");
			// await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'file_selection_review', fileSelection: [{ filePath: 'updated.ts', category: 'edit', reason: 'Updated by prompt' }], lastAgentActivity: Date.now() });
		} catch (error) {
			logger.error(error, `[VibeServiceImpl] Failed to update selection with prompt for session ${sessionId}`);
			// Optionally update session status to error here if appropriate and not already handled
			// await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'error_file_selection', error: error.message, lastAgentActivity: Date.now() });
			throw error; // Re-throw the error to be handled by the caller
		}
	}

	async generateDetailedDesign(userId: string, sessionId: string, variations: number): Promise<void> {
		logger.info({ userId, sessionId, variations }, '[VibeServiceImpl] generateDetailedDesign called');
		try {
			// 1. Get session & validate
			const session = await this.vibeRepo.getVibeSession(userId, sessionId);
			if (!session) {
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}
			if (session.userId !== userId) {
				// This check might be redundant if the repository enforces user scope, but good practice
				throw new Error('User not authorized for this session.');
			}
			if (session.status !== 'file_selection_review') {
				throw new Error(`Invalid session status: Cannot generate design in current state '${session.status}'. Expected 'file_selection_review'.`);
			}
			if (!session.fileSelection || session.fileSelection.length === 0) {
				throw new Error('Cannot generate design: File selection is missing or empty.');
			}

			// 2. Update status to 'generating_design' in repo
			logger.info({ sessionId }, '[VibeServiceImpl] Updating session status to generating_design...');
			await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'generating_design', lastAgentActivity: Date.now() });

			// 3. Trigger agent asynchronously
			// TODO: Trigger runDesignGenerationAgent asynchronously with session.fileSelection and variations.
			// The agent's callback/result handler would then update the repo with the new
			// designAnswer and set the status to 'design_review' or 'error_design_generation'.
			logger.info({ sessionId }, '[VibeServiceImpl] Design generation process initiated.');

			// Placeholder for async agent call simulation (remove when agent is integrated)
			// Simulating a delay and potential error for now
			// await new Promise(resolve => setTimeout(resolve, 1500));
			// logger.info({ sessionId }, "[VibeServiceImpl] Placeholder agent call finished.");
			// await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'design_review', designAnswer: { summary: 'Generated design', steps: [], reasoning: '' }, lastAgentActivity: Date.now() });
		} catch (error) {
			logger.error(error, `[VibeServiceImpl] Failed to generate detailed design for session ${sessionId}`);
			// Optionally update session status to error here if appropriate and not already handled
			// await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'error_design_generation', error: error.message, lastAgentActivity: Date.now() });
			throw error; // Re-throw the error to be handled by the caller
		}
	}

	async updateDesignWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void> {
		logger.info({ userId, sessionId, prompt }, '[VibeServiceImpl] updateDesignWithPrompt called');
		// 1. Get session & validate status (e.g., 'design_review_details') & designAnswer exists
		// 2. Update status to 'updating_design' in repo
		// 3. Trigger runDesignGenerationAgent with prompt (async)
		// 4. Agent result callback -> updates repo with new designAnswer & status 'design_review_details' or 'error'
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'updating_design', lastAgentActivity: Date.now() });
		logger.warn('[VibeServiceImpl] updateDesignWithPrompt - Agent triggering not implemented.');
		await new Promise((resolve) => setTimeout(resolve, 500));
		await this.vibeRepo.updateVibeSession(userId, sessionId, {
			status: 'error_design_generation',
			error: 'Agent call not implemented',
			lastAgentActivity: Date.now(),
		});
		// throw new Error('updateDesignWithPrompt - Not Implemented');
	}

	async updateDesignWithInstructions(userId: string, sessionId: string, data: UpdateDesignInstructionsData): Promise<void> {
		logger.info({ userId, sessionId, data }, '[VibeServiceImpl] updateDesignWithInstructions called');
		// Similar flow to updateDesignWithPrompt, passing structured data to agent
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'updating_design', lastAgentActivity: Date.now() });
		logger.warn('[VibeServiceImpl] updateDesignWithInstructions - Agent triggering not implemented.');
		await new Promise((resolve) => setTimeout(resolve, 500));
		await this.vibeRepo.updateVibeSession(userId, sessionId, {
			status: 'error_design_generation',
			error: 'Agent call not implemented',
			lastAgentActivity: Date.now(),
		});
		// throw new Error('updateDesignWithInstructions - Not Implemented');
	}

	async acceptDesign(userId: string, sessionId: string, variations: number): Promise<void> {
		logger.info({ userId, sessionId, variations }, '[VibeServiceImpl] acceptDesign called');
		try {
			const session = await this.vibeRepo.getVibeSession(userId, sessionId);
			if (!session) {
				throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			}
			// Redundant check if repo enforces user scope, but good practice
			if (session.userId !== userId) {
				throw new Error('User not authorized for this session.');
			}
			if (session.status !== 'design_review') {
				throw new Error(`Invalid session status: Expected 'design_review', got '${session.status}'.`);
			}

			await this.vibeRepo.updateVibeSession(userId, sessionId, {
				status: 'coding',
				selectedVariations: variations,
				lastAgentActivity: Date.now(),
			});
			logger.info({ sessionId }, 'Session status updated to coding and variations stored.');

			// Trigger the coding agent
			await this.executeDesign(userId, sessionId);
			logger.info({ sessionId }, 'executeDesign triggered.');
		} catch (error) {
			logger.error(error, `[VibeServiceImpl] Failed to accept design for session ${sessionId}`);
			// Optionally update session status to error here if appropriate
			throw error; // Re-throw the error to be handled by the caller
		}
	}

	async executeDesign(userId: string, sessionId: string): Promise<void> {
		logger.info({ userId, sessionId }, '[VibeServiceImpl] executeDesign called');
		// 1. Get session & validate status (e.g., 'design_review' or 'design_review_details') & designAnswer/fileSelection exist
		// 2. Update status to 'coding' in repo
		// 3. Trigger runCodeEditingAgent (async)
		// 4. Agent result callback -> updates repo with codeDiff & status 'code_review' or 'error'
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'coding', lastAgentActivity: Date.now() });
		logger.warn('[VibeServiceImpl] executeDesign - Agent triggering not implemented.');
		await new Promise((resolve) => setTimeout(resolve, 500));
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'error_coding', error: 'Agent call not implemented', lastAgentActivity: Date.now() });
		// throw new Error('executeDesign - Not Implemented');
	}

	async startCoding(userId: string, sessionId: string): Promise<void> {
		logger.warn({ userId, sessionId }, '[VibeServiceImpl] startCoding is deprecated, calling executeDesign.');
		await this.executeDesign(userId, sessionId);
	}

	async updateCodeWithComments(userId: string, sessionId: string, data: UpdateCodeReviewData): Promise<void> {
		logger.info({ userId, sessionId, data }, '[VibeServiceImpl] updateCodeWithComments called');
		// 1. Get session & validate status (e.g., 'code_review') & codeDiff exists
		// 2. Update status to 'coding' in repo
		// 3. Trigger runCodeEditingAgent with comments (async)
		// 4. Agent result callback -> updates repo with new codeDiff & status 'code_review' or 'error'
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'coding', lastAgentActivity: Date.now() });
		logger.warn('[VibeServiceImpl] updateCodeWithComments - Agent triggering not implemented.');
		await new Promise((resolve) => setTimeout(resolve, 500));
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'error_coding', error: 'Agent call not implemented', lastAgentActivity: Date.now() });
		// throw new Error('updateCodeWithComments - Not Implemented');
	}

	async commitChanges(userId: string, sessionId: string, data: CommitChangesData): Promise<{ commitSha: string; pullRequestUrl?: string }> {
		logger.info({ userId, sessionId, data }, '[VibeServiceImpl] commitChanges called');
		// 1. Get session & validate status (e.g., 'code_review')
		// 2. Update status to 'committing' in repo
		// 3. Perform SCM operations: commit, push, create PR/MR (using SCM service/library)
		// 4. Update repo with commitSha, pullRequestUrl, status 'completed' or 'monitoring_ci' or 'error'
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'committing', lastAgentActivity: Date.now() });
		logger.warn('[VibeServiceImpl] commitChanges - SCM operations not implemented.');
		await new Promise((resolve) => setTimeout(resolve, 500));
		// Simulate success for now
		const result = { commitSha: `impl-sha-${randomUUID().substring(0, 8)}`, pullRequestUrl: undefined };
		await this.vibeRepo.updateVibeSession(userId, sessionId, {
			status: 'completed',
			commitSha: result.commitSha,
			pullRequestUrl: result.pullRequestUrl,
			lastAgentActivity: Date.now(),
		});
		return result;
		// throw new Error('commitChanges - Not Implemented');
	}

	// --- Helper / Supporting Methods (Placeholders - Need Implementation) ---

	async getBranchList(userId: string, repositorySource: 'local' | 'github' | 'gitlab', repositoryId: string): Promise<string[]> {
		logger.debug({ userId, repositorySource, repositoryId }, '[VibeServiceImpl] getBranchList called');
		// TODO: Implement SCM interaction
		logger.warn('[VibeServiceImpl] getBranchList - SCM interaction not implemented.');
		return ['main', 'develop', 'feat/placeholder-impl'];
	}

	async getFileSystemTree(userId: string, sessionId: string, directoryPath?: string): Promise<FileSystemNode[]> {
		logger.debug({ userId, sessionId, directoryPath }, '[VibeServiceImpl] getFileSystemTree called');
		// TODO: Implement interaction with FileSystemService for the session's workspace
		logger.warn('[VibeServiceImpl] getFileSystemTree - Filesystem interaction not implemented.');
		return [{ path: 'placeholder.txt', name: 'placeholder.txt', type: 'file' }];
	}

	async getFileContent(userId: string, sessionId: string, filePath: string): Promise<string> {
		logger.debug({ userId, sessionId, filePath }, '[VibeServiceImpl] getFileContent called');
		// TODO: Implement interaction with FileSystemService for the session's workspace
		logger.warn('[VibeServiceImpl] getFileContent - Filesystem interaction not implemented.');
		return `// Placeholder content for ${filePath}`;
	}

	// applyCiCdFix is optional in the interface, so no placeholder needed unless implemented
}
