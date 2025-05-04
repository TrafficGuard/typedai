import type {
	CommitChangesData,
	CreateVibeSessionData,
	FileSystemNode,
	UpdateCodeReviewData,
	UpdateDesignInstructionsData,
	UpdateVibeSessionData,
	VibePreset,
	VibeSession,
} from './vibeTypes';

/**
 * Interface for managing VibeSession data and orchestrating the Vibe Coding workflow.
 */
export interface VibeService {
	// --- Core CRUD ---

	/**
	 * Creates a new VibeSession based on initial user input.
	 * Sets the status to 'initializing'.
	 * Asynchronously triggers the initialization process (cloning, file selection, design gen).
	 * @param userId The ID of the user creating the session.
	 * @param sessionData Data for the new session (title, instructions, repo info, etc.).
	 * @returns The newly created VibeSession with status 'initializing'.
	 */
	createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession>;

	/**
	 * Retrieves a specific VibeSession by its ID for a given user.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to retrieve.
	 * @returns The VibeSession if found and authorized, otherwise null.
	 */
	getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null>;

	/**
	 * Lists all VibeSessions for the current user, ordered by creation date descending.
	 * @param userId The ID of the user whose sessions to list.
	 * @returns An array of VibeSessions.
	 */
	listVibeSessions(userId: string): Promise<VibeSession[]>;

	/**
	 * Updates specified fields of a VibeSession. Use for simple updates like editing
	 * the title, instructions, manually changing fileSelection, or internal status updates.
	 * For actions triggering agents, use specific methods below.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to update.
	 * @param updates An object containing the fields to update. Must match UpdateVibeSessionData.
	 * @returns {Promise<void>}
	 */
	updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void>;

	/**
	 * Deletes a VibeSession by its ID for a given user. Cleans up associated resources (e.g., workspace).
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to delete.
	 * @returns {Promise<void>}
	 */
	deleteVibeSession(userId: string, sessionId: string): Promise<void>;

	// --- Preset Management ---

	/**
	 * Saves a new Vibe Preset configuration for the user.
	 * @param userId The ID of the user saving the preset.
	 * @param name The user-defined name for the preset.
	 * @param config The configuration data to save, excluding title and instructions.
	 * @returns The newly created VibePreset object.
	 */
	saveVibePreset(userId: string, name: string, config: Omit<CreateVibeSessionData, 'title' | 'instructions'>): Promise<VibePreset>;

	/**
	 * Lists all Vibe Presets saved by the user.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of VibePreset objects.
	 */
	listVibePresets(userId: string): Promise<VibePreset[]>;

	/**
	 * Deletes a specific Vibe Preset for the user.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the VibePreset to delete.
	 * @returns {Promise<void>}
	 */

	/**
	 * Saves a new Vibe Preset configuration for the user.
	 * @param userId The ID of the user saving the preset.
	 * @param name The user-defined name for the preset.
	 * @param config The configuration data to save, excluding title and instructions.
	 * @returns The newly created VibePreset object.
	 */
	saveVibePreset(userId: string, name: string, config: Omit<CreateVibeSessionData, 'title' | 'instructions'>): Promise<VibePreset>;

	/**
	 * Lists all Vibe Presets saved by the user.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of VibePreset objects.
	 */
	listVibePresets(userId: string): Promise<VibePreset[]>;

	/**
	 * Deletes a specific Vibe Preset for the user.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the VibePreset to delete.
	 * @returns {Promise<void>}
	 */
	deleteVibePreset(userId: string, presetId: string): Promise<void>;

	// --- Workflow Actions ---

	/**
	 * [Internal or Explicit Trigger] Handles the initialization after creation:
	 * Clones repo, creates branch (if needed), runs selectFilesAgent, generates initial design.
	 * Updates session status from 'initializing' to 'design_review' or 'error'.
	 * Populates 'fileSelection' and 'designAnswer'.
	 * NOTE: This might be triggered internally after createVibeSession or via a dedicated endpoint/call.
	 * If triggered explicitly:
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession to initialize.
	 * @returns {Promise<void>} Resolves when the initialization process is queued or complete.
	 */
	// initializeVibeSession?(userId: string, sessionId: string): Promise<void>; // Keep optional depending on trigger mechanism

	/**
	 * Updates the file selection based on user prompt.
	 * Triggers agent, sets status to `updating_selection`.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param prompt The user's prompt for refining the file selection.
	 * @returns {Promise<void>} Resolves when the update process is queued.
	 */
	updateSelectionWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void>;

	/**
	 * Generates a detailed design, potentially with variations.
	 * Triggers agent, sets status to `generating_design`.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param variations The number of design variations to generate (optional, defaults might apply).
	 * @returns {Promise<void>} Resolves when the design generation is queued.
	 */
	generateDetailedDesign(userId: string, sessionId: string, variations: number): Promise<void>;

	/**
	 * Accepts a specific design variation and proceeds to the coding phase.
	 * Sets status to `coding`, stores selected variations.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param variations The number/index of the design variation accepted by the user.
	 * @returns {Promise<void>} Resolves when the acceptance is processed and coding is queued.
	 */
	acceptDesign(userId: string, sessionId: string, variations: number): Promise<void>;

	/**
	 * Updates the design based on user prompt.
	 * Triggers agent, sets status to `updating_design`.
	 * Consider if `updateDesignWithInstructions` can be reused/adapted in implementation.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param prompt The user's prompt for refining the design.
	 * @returns {Promise<void>} Resolves when the design update is queued.
	 */
	updateDesignWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void>;

	/**
	 * Updates the design ('designAnswer') based on user instructions.
	 * Triggers an AI agent call. Updates session status if needed (e.g., back to 'design_review').
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param data Object containing the new instructions.
	 */
	updateDesignWithInstructions(userId: string, sessionId: string, data: UpdateDesignInstructionsData): Promise<void>;

	/**
	 * Executes the approved design by triggering code generation.
	 * Triggers `codeEditingAgent`, sets status to `coding`.
	 * Consider if `startCoding` can be reused/adapted in implementation.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @returns {Promise<void>} Resolves when the coding process is queued.
	 */
	executeDesign(userId: string, sessionId: string): Promise<void>;

	/**
	 * Starts the code generation process based on the current 'fileSelection' and 'designAnswer'.
	 * Sets status to 'coding'. Asynchronously triggers the CodeEditingAgent.
	 * Agent completion will update status to 'code_review' and populate 'codeDiff'.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @returns {Promise<void>} Resolves when the coding process is queued.
	 */
	startCoding(userId: string, sessionId: string): Promise<void>;

	/**
	 * Requests revisions to the generated code based on user review comments.
	 * Sets status back to 'coding'. Asynchronously triggers the CodeEditingAgent with comments.
	 * Agent completion will update status to 'code_review' and update 'codeDiff'.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param data Object containing the review comments/instructions.
	 * @returns {Promise<void>} Resolves when the code revision process is queued.
	 */
	updateCodeWithComments(userId: string, sessionId: string, data: UpdateCodeReviewData): Promise<void>;

	/**
	 * Finalizes the Vibe session: commits the changes, pushes the branch,
	 * and optionally creates a Pull/Merge Request.
	 * Updates session with commit SHA, PR URL (if applicable), and sets status to 'completed' or 'monitoring_ci'.
	 * Requires session status to be 'code_review' (or similar state indicating readiness).
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param data Object containing the final commit title and message.
	 * @returns The final commit SHA and PR URL.
	 */
	commitChanges(userId: string, sessionId: string, data: CommitChangesData): Promise<{ commitSha: string; pullRequestUrl?: string }>;

	// --- Helper / Supporting Methods ---

	/**
	 * Retrieves the list of branches for a given repository.
	 * Needed for the UI during session creation.
	 * @param userId The ID of the user making the request.
	 * @param repositorySource The source type ('local', 'github', 'gitlab').
	 * @param repositoryId The specific repository identifier.
	 * @returns A promise resolving to an array of branch names.
	 */
	getBranchList(userId: string, repositorySource: 'local' | 'github' | 'gitlab', repositoryId: string): Promise<string[]>;

	/**
	 * Retrieves the file system tree structure for the checked-out repository within a session's workspace.
	 * Needed for the UI file selection component. Requires the session to be initialized.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param directoryPath The subdirectory to list (optional, defaults to root).
	 * @returns A promise resolving to an array of FileSystemNode objects.
	 */
	getFileSystemTree(userId: string, sessionId: string, directoryPath?: string): Promise<FileSystemNode[]>;

	/**
	 * Retrieves the content of a specific file within the session's workspace.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param filePath The path to the file relative to the repository root.
	 * @returns A promise resolving to the file content as a string.
	 */
	getFileContent(userId: string, sessionId: string, filePath: string): Promise<string>;

	/**
	 * (Optional) Applies the AI-proposed fix for a CI/CD failure.
	 * May trigger another coding/commit cycle.
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @returns {Promise<void>}
	 */
	applyCiCdFix?(userId: string, sessionId: string): Promise<void>;
}
