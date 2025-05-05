import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { agentContextStorage } from '#agent/agentContextLocalStorage';
import type { AgentContext } from '#agent/agentContextTypes';
import { startWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { systemDir } from '#app/appVars';
import { appContext } from '#app/applicationContext';
import { getSourceControlManagementTool } from '#functions/scm/sourceControlManagement';
import type { VersionControlSystem } from '#functions/scm/versionControlSystem';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import { type SelectedFile as OriginalSelectedFile, selectFilesAgent } from '#swe/discovery/selectFilesAgent'; // Assuming OriginalSelectedFile type export
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
			agentHistory: [], // Initialize new field
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
		let workspacePath: string; // Declare workspacePath here
		let fss: FileSystemService | null = null; // Define fss here to be accessible in finally block if needed

		try {
			logger.info({ userId, sessionId }, '[VibeServiceImpl] Starting background initialization...');

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

			// Calculate Workspace Path based on session settings
			if (!session.useSharedRepos) {
				// Use session-specific workspace
				workspacePath = join(systemDir(), 'vibe', session.id);
				logger.info({ sessionId, useSharedRepos: false, workspacePath }, 'Calculated session-specific workspace path.');
			} else {
				// Use shared repository workspace
				logger.info(
					{ sessionId, useSharedRepos: true, repositorySource: session.repositorySource, repositoryId: session.repositoryId },
					'Calculating shared repository workspace path...',
				);
				if (session.repositorySource !== 'github' && session.repositorySource !== 'gitlab') {
					throw new Error(`Invalid repositorySource "${session.repositorySource}" for shared repository. Must be 'github' or 'gitlab'.`);
				}
				const repoIdParts = session.repositoryId.split('/');
				if (repoIdParts.length !== 2 || !repoIdParts[0] || !repoIdParts[1]) {
					throw new Error(`Invalid repositoryId format "${session.repositoryId}" for shared repository. Expected "namespace/repoName".`);
				}
				const [namespace, repoName] = repoIdParts;
				workspacePath = join(systemDir(), session.repositorySource, namespace, repoName);
				logger.info({ sessionId, namespace, repoName, workspacePath }, 'Calculated shared workspace path.');
			}

			// 2. Ensure Workspace Directory Exists (Target for clone)
			logger.info({ sessionId, workspacePath }, 'Ensuring target workspace directory exists...');
			await fs.mkdir(workspacePath, { recursive: true });
			logger.info({ sessionId, workspacePath }, 'Target workspace directory ensured.');

			// 3. SCM Setup
			logger.info({ sessionId }, '[VibeServiceImpl] Starting SCM setup...');
			const scm = await getSourceControlManagementTool();
			if (!scm.isConfigured()) throw new Error(`SCM provider (${scm.getScmType()}) is not configured. Cannot clone repository.`);

			// Clone the project - assumes repositoryId is 'owner/repo' or similar
			// cloneProject should ideally use the agentContext's fileSystem basePath
			const clonedRepoPath = await scm.cloneProject(session.repositoryId, session.targetBranch);
			// Verify the path returned by cloneProject. Ideally, it matches workspacePath.
			if (clonedRepoPath !== workspacePath) {
				logger.warn(
					{ sessionId, clonedRepoPath, expectedPath: workspacePath },
					'Cloned repository path differs from calculated workspace path. Using actual cloned path.',
				);
				// If cloneProject creates a subdirectory (e.g., workspacePath/repoName), clonedRepoPath will be different.
				// We MUST use clonedRepoPath for the FileSystemService.
			} else {
				logger.info({ sessionId, clonedRepoPath }, 'Repository cloned/updated into calculated workspace path.');
			}

			// Initialize FileSystemService rooted in the *actual* cloned path
			fss = new FileSystemService(clonedRepoPath);
			logger.info({ sessionId, repoPath: fss.getWorkingDirectory() }, 'FileSystemService initialized for repository path.');

			// Prepare agent context fragment *after* fss is initialized
			const agentContextFragment: Pick<AgentContext, 'fileSystem' | 'user'> = {
				fileSystem: fss,
				user: user,
			};

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

			await this.runVibeWorkflowAgent(session, 'selectFiles', async () => {
				// selectFilesAgent expects UserContentExt, pass instructions directly
				const selection = await selectFilesAgent(session.instructions);
				logger.info({ sessionId, fileCount: selection?.length }, 'selectFilesAgent completed.');

				if (!selection || !Array.isArray(selection)) throw new Error('Invalid response structure from selectFilesAgent');

				// Map the result from selectFilesAgent's SelectedFile to Vibe's SelectedFile
				const fileSelectionResult = selection.map((sf) => ({
					filePath: sf.path, // Map 'path' to 'filePath'
					reason: sf.reason,
					// category: sf.category, // Category removed from agent response
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
				if (error.message?.includes('repositorySource') || error.message?.includes('repositoryId format')) {
					errorStatus = 'error'; // Or potentially a new status like 'error_configuration'
				} else if (error.message?.includes('SCM') || error.message?.includes('clone') || error.message?.includes('branch')) {
					// Keep existing SCM error logic
					errorStatus = 'error'; // Or a specific SCM error status
				} else if (error.message?.includes('selectFilesAgent')) {
					errorStatus = 'error_file_selection';
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

	async runVibeWorkflowAgent(vibe: VibeSession, subtype: string, workflow: () => any): Promise<any> {
		// Prepare agent config, ensuring vibeSessionId is included
		const execution = await startWorkflowAgent(
			{
				agentName: `vibe-${vibe.id}-${subtype}`,
				functions: [], // TODO: Add necessary functions (e.g., SCM, FileSystem)
				initialPrompt: vibe.instructions, // Or specific prompt for the step
				vibeSessionId: vibe.id,
				subtype,
				// Assuming user is fetched earlier or passed in vibe object if needed
				// user: vibe.user,
				// Assuming fileSystemPath is derived correctly for the session
				// fileSystemPath: join(process.cwd(), 'vibe-workspaces', vibe.userId, vibe.id),
			},
			workflow,
		);

		// Update VibeSession state immediately after starting the agent
		const agentId = execution.agentId;
		await this.vibeRepo.updateVibeSession(vibe.userId, vibe.id, {
			agentHistory: [...(vibe.agentHistory || []), agentId], // Append to history
			lastAgentActivity: Date.now(),
		});
		logger.info({ vibeId: vibe.id, agentId, subtype }, 'VibeSession updated with current agent and history.');

		await execution.execution;
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

	// --- Workflow Orchestration Actions ---

	async updateSelectionWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void> {
		logger.info({ userId, sessionId, prompt }, '[VibeServiceImpl] updateSelectionWithPrompt called');
		// 1. Get session & validate
		logger.debug({ userId, sessionId }, '[VibeServiceImpl] Getting session for selection update...');
		const session = await this.vibeRepo.getVibeSession(userId, sessionId);
		if (!session) throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		if (session.userId !== userId) throw new Error('User not authorized for this session.'); // Redundant check if repo enforces scope, but good practice
		if (session.status !== 'file_selection_review') {
			throw new Error(`Invalid session status: Cannot update selection in current state '${session.status}'. Expected 'file_selection_review'.`);
		}

		// 2. Update status to 'updating_selection' in repo
		logger.info({ sessionId }, '[VibeServiceImpl] Updating session status to updating_selection...');
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'updating_selection', lastAgentActivity: Date.now() });

		// 3. Trigger agent asynchronously using runVibeWorkflowAgent
		logger.info({ sessionId }, '[VibeServiceImpl] Triggering background agent for file selection update via runVibeWorkflowAgent.');
		// No await - runs in background
		this._runFileSelectionUpdateAgent(userId, session, prompt);
	}

	/**
	 * Runs the file selection agent asynchronously using runVibeWorkflowAgent.
	 */
	private _runFileSelectionUpdateAgent(userId: string, session: VibeSession, prompt: string): void {
		const sessionId = session.id;
		logger.info({ userId, sessionId }, '[VibeServiceImpl] Scheduling background file selection update agent via runVibeWorkflowAgent...');

		// Define the workflow function to be executed by the agent runner
		const workflow = async () => {
			// Agent context is available here via agentContext() which is set by runVibeWorkflowAgent
			const currentAgentContext = agentContextStorage.getStore(); // Get the full context
			if (!currentAgentContext) throw new Error('Agent context not available in workflow.');
			// We don't need to manually set up FSS or user context here, it's provided by the runner.

			// Prepare inputs using session data and prompt
			const instructions = session.instructions;
			const currentSelection: SelectedFile[] = session.fileSelection || [];
			const agentInputFiles: OriginalSelectedFile[] = currentSelection.map((sf) => ({
				path: sf.filePath, // Map 'filePath' to 'path'
				reason: sf.reason,
				// category: sf.category, // Category removed
				readonly: sf.readOnly, // Map 'readOnly' to 'readonly'
			}));

			logger.debug({ sessionId }, 'Preparing inputs for selectFilesAgent within workflow...');
			// Call selectFilesAgent with the corrected signature (3 arguments: requirements, projectInfo, options)
			// Pass undefined for projectInfo for now, assuming selectFilesAgent handles it internally if needed.
			// The agent context (including fileSystem) is implicitly available to selectFilesAgent via agentContextStorage
			const updatedSelectionRaw = await selectFilesAgent(instructions, undefined, { currentFiles: agentInputFiles, updatePrompt: prompt });

			// Map results
			if (!updatedSelectionRaw || !Array.isArray(updatedSelectionRaw)) {
				throw new Error('Invalid response structure from selectFilesAgent during update.');
			}
			const mappedResult: SelectedFile[] = updatedSelectionRaw.map((sf) => ({
				filePath: sf.path, // Map 'path' back to 'filePath'
				reason: sf.reason,
				// category: sf.category, // Category removed
				readOnly: sf.readonly, // Map 'readonly' back to 'readOnly'
			}));
			logger.info({ sessionId, count: mappedResult.length }, 'selectFilesAgent completed and result mapped within workflow.');

			// Update Repo (Success) - Use userId and sessionId from outer scope
			await this.vibeRepo.updateVibeSession(userId, sessionId, {
				fileSelection: mappedResult,
				status: 'file_selection_review',
				lastAgentActivity: Date.now(),
				error: null,
			});
			logger.info({ sessionId }, 'Successfully updated file selection and status within workflow.');
		};

		// Run the workflow using runVibeWorkflowAgent
		// This handles setting up the agent context, running the workflow, and basic error handling/logging
		this.runVibeWorkflowAgent(session, 'updateFileSelection', workflow).catch((error) => {
			// Catch errors specifically from the runVibeWorkflowAgent promise itself
			// (e.g., if the agent runner fails to start)
			// Errors *within* the workflow are typically handled by the runner or the workflow itself
			logger.error(error, `[VibeServiceImpl] Error occurred during runVibeWorkflowAgent for session ${sessionId}`);
			// Attempt to update session status to error
			this.vibeRepo
				.updateVibeSession(userId, sessionId, {
					status: 'error_file_selection',
					error: error instanceof Error ? error.message : String(error),
					lastAgentActivity: Date.now(),
				})
				.catch((updateError) => {
					logger.error(updateError, `[VibeServiceImpl] Failed to update session ${sessionId} status to error after agent runner failure.`);
				});
		});
	}

	async generateDetailedDesign(userId: string, sessionId: string, variations = 1): Promise<void> {
		// Ensure variations is at least 1
		variations = Math.max(1, variations);
		logger.info({ userId, sessionId, variations }, '[VibeServiceImpl] generateDetailedDesign called');

		// 1. Get session & validate
		const session = await this.vibeRepo.getVibeSession(userId, sessionId);
		if (!session) throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		if (session.userId !== userId) throw new Error('User not authorized for this session.');
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
		const workflow = async () => {
			logger.info({ sessionId }, 'Starting background design generation workflow...');
			// Use the session object captured from the outer scope
			const currentSession = session;

			// Placeholder/Mock Design Agent
			const mockGenerateDesignAgent = async (instructions: string, files: SelectedFile[], vars: number): Promise<DesignAnswer> => {
				logger.debug({ sessionId, fileCount: files.length, vars }, 'Mock design agent running...');
				await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate work
				return {
					summary: 'Mock Design Summary',
					steps: ['Mock Step 1', 'Mock Step 2'],
					reasoning: `This is mock reasoning based on instructions ("${instructions.substring(0, 50)}...") and ${files.length} files. Variations requested: ${vars}.`,
				};
			};

			const designAnswer = await mockGenerateDesignAgent(currentSession.instructions, currentSession.fileSelection!, variations);
			logger.info({ sessionId }, 'Mock design agent completed.');

			// Update session on success
			await this.vibeRepo.updateVibeSession(userId, sessionId, {
				status: 'design_review',
				designAnswer: designAnswer,
				error: null, // Clear previous error
				lastAgentActivity: Date.now(),
			});
			logger.info({ sessionId }, 'Successfully generated mock design and updated session status.');
		};

		// Run the workflow using runVibeWorkflowAgent
		this.runVibeWorkflowAgent(session, 'generateDesign', workflow).catch(async (error) => {
			logger.error(error, `[VibeServiceImpl] Error occurred during runVibeWorkflowAgent for design generation session ${sessionId}`);
			try {
				await this.vibeRepo.updateVibeSession(userId, sessionId, {
					status: 'error_design_generation',
					error: error instanceof Error ? error.message : String(error),
					lastAgentActivity: Date.now(),
				});
			} catch (updateError) {
				logger.error(updateError, `[VibeServiceImpl] Failed to update session ${sessionId} status to error after agent runner failure.`);
			}
		});
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

	// --- Helper / Supporting Methods ---

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
