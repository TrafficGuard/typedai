import type {
	CommitChangesData,
	CreateVibeSessionData,
	FileSystemNode,
	UpdateCodeReviewData,
	UpdateDesignInstructionsData,
	UpdateVibeSessionData,
	VibeSession,
} from './vibeTypes'; // Adjust path if needed, assuming it's relative

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
	 * Updates the design ('designAnswer') based on user instructions.
	 * Triggers an AI agent call. Updates session status if needed (e.g., back to 'design_review').
	 * @param userId The ID of the user owning the session.
	 * @param sessionId The ID of the VibeSession.
	 * @param data Object containing the new instructions.
	 * @returns {Promise<void>} Resolves when the design update is queued or complete.
	 */
	updateDesignWithInstructions(userId: string, sessionId: string, data: UpdateDesignInstructionsData): Promise<void>;

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
