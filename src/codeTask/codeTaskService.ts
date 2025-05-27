import type { CodeTask, CodeTaskPreset, CommitChangesData, CreateCodeTaskData, UpdateCodeReviewData, UpdateCodeTaskData } from '#shared/model/codeTask.model';
import type { FileSystemNode } from '#shared/services/fileSystemService';

/**
 * Interface for managing CodeTask data and orchestrating the CodeTask Coding workflow.
 */
export interface CodeTaskService {
	// --- Core CRUD ---

	/**
	 * Creates a new CodeTask based on initial user input.
	 * Sets the status to 'initializing'.
	 * Asynchronously triggers the initialization process (cloning, file selection, design gen).
	 * @param userId The ID of the user creating the codeTask.
	 * @param codeTaskData Data for the new codeTask (title, instructions, repo info, etc.).
	 * @returns The newly created CodeTask with status 'initializing'.
	 */
	createCodeTask(userId: string, codeTaskData: CreateCodeTaskData): Promise<CodeTask>;

	/**
	 * Retrieves a specific CodeTask by its ID for a given user.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to retrieve.
	 * @returns The CodeTask if found and authorized, otherwise null.
	 */
	getCodeTask(userId: string, codeTaskId: string): Promise<CodeTask | null>;

	/**
	 * Lists all CodeTasks for the current user, ordered by creation date descending.
	 * @param userId The ID of the user whose codeTasks to list.
	 * @returns An array of CodeTasks.
	 */
	listCodeTasks(userId: string): Promise<CodeTask[]>;

	/**
	 * Updates specified fields of a CodeTask. Use for simple updates like editing
	 * the title, instructions, manually changing fileSelection, or internal status updates.
	 * For actions triggering agents, use specific methods below.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to update.
	 * @param updates An object containing the fields to update. Must match UpdateCodeTaskData.
	 * @returns {Promise<void>}
	 */
	updateCodeTask(userId: string, codeTaskId: string, updates: UpdateCodeTaskData): Promise<void>;

	/**
	 * Deletes a CodeTask by its ID for a given user. Cleans up associated resources (e.g., workspace).
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to delete.
	 * @returns {Promise<void>}
	 */
	deleteCodeTask(userId: string, codeTaskId: string): Promise<void>;

	// --- Preset Management ---

	/**
	 * Saves a new CodeTask Preset configuration for the user.
	 * @param userId The ID of the user saving the preset.
	 * @param name The user-defined name for the preset.
	 * @param config The configuration data to save, excluding title and instructions.
	 * @returns The newly created CodeTaskPreset object.
	 */
	saveCodeTaskPreset(userId: string, name: string, config: Omit<CreateCodeTaskData, 'title' | 'instructions'>): Promise<CodeTaskPreset>;

	/**
	 * Lists all CodeTask Presets saved by the user.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of CodeTaskPreset objects.
	 */
	listCodeTaskPresets(userId: string): Promise<CodeTaskPreset[]>;

	/**
	 * Deletes a specific CodeTask Preset for the user.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the CodeTaskPreset to delete.
	 * @returns {Promise<void>}
	 */

	/**
	 * Saves a new CodeTask Preset configuration for the user.
	 * @param userId The ID of the user saving the preset.
	 * @param name The user-defined name for the preset.
	 * @param config The configuration data to save, excluding title and instructions.
	 * @returns The newly created CodeTaskPreset object.
	 */
	saveCodeTaskPreset(userId: string, name: string, config: Omit<CreateCodeTaskData, 'title' | 'instructions'>): Promise<CodeTaskPreset>;

	/**
	 * Lists all CodeTask Presets saved by the user.
	 * @param userId The ID of the user whose presets to list.
	 * @returns An array of CodeTaskPreset objects.
	 */
	listCodeTaskPresets(userId: string): Promise<CodeTaskPreset[]>;

	/**
	 * Deletes a specific CodeTask Preset for the user.
	 * @param userId The ID of the user owning the preset.
	 * @param presetId The ID of the CodeTaskPreset to delete.
	 * @returns {Promise<void>}
	 */
	deleteCodeTaskPreset(userId: string, presetId: string): Promise<void>;

	// --- Workflow Actions ---

	/**
	 * [Internal or Explicit Trigger] Handles the initialization after creation:
	 * Clones repo, creates branch (if needed), runs selectFilesAgent, generates initial design.
	 * Updates codeTask status from 'initializing' to 'design_review' or 'error'.
	 * Populates 'fileSelection' and 'designAnswer'.
	 * NOTE: This might be triggered internally after createCodeTask or via a dedicated endpoint/call.
	 * If triggered explicitly:
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask to initialize.
	 * @returns {Promise<void>} Resolves when the initialization process is queued or complete.
	 */
	// initializeCodeTask?(userId: string, codeTaskId: string): Promise<void>; // Keep optional depending on trigger mechanism

	/**
	 * Updates the file selection based on user prompt.
	 * Triggers agent, sets status to `updating_selection`.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param prompt The user's prompt for refining the file selection.
	 * @returns {Promise<void>} Resolves when the update process is queued.
	 */
	updateSelectionWithPrompt(userId: string, codeTaskId: string, prompt: string): Promise<void>;

	/**
	 * Generates a detailed design, potentially with variations.
	 * Triggers agent, sets status to `generating_design`.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param variations The number of design variations to generate (optional, defaults might apply).
	 * @returns {Promise<void>} Resolves when the design generation is queued.
	 */
	generateDetailedDesign(userId: string, codeTaskId: string, variations: number): Promise<void>;

	/**
	 * Accepts a specific design variation and proceeds to the coding phase.
	 * Sets status to `coding`, stores selected variations.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param variations The number/index of the design variation accepted by the user.
	 * @returns {Promise<void>} Resolves when the acceptance is processed and coding is queued.
	 */
	acceptDesign(userId: string, codeTaskId: string, variations: number): Promise<void>;

	/**
	 * Updates the design from manual user edits
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param updatedDesign The updated design provided by the user
	 * @returns {Promise<void>} Resolves when updated design is saved to the repository.
	 */
	updateDesign(userId: string, codeTaskId: string, updatedDesign: string): Promise<void>;

	/**
	 * Updates the design ('designAnswer') based on user instructions for an LLM agent to update.
	 * Triggers an AI agent call. Updates codeTask status if needed (e.g., back to 'design_review').
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param designUpdateInstructions Instructions on how to update the design.
	 */
	updateDesignFromInstructions(userId: string, codeTaskId: string, designUpdateInstructions: string): Promise<void>;

	/**
	 * Executes the approved design by triggering code generation.
	 * Triggers `codeEditingAgent`, sets status to `coding`.
	 * Consider if `startCoding` can be reused/adapted in implementation.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @returns {Promise<void>} Resolves when the coding process is queued.
	 */
	executeDesign(userId: string, codeTaskId: string): Promise<void>;

	/**
	 * Starts the code generation process based on the current 'fileSelection' and 'designAnswer'.
	 * Sets status to 'coding'. Asynchronously triggers the CodeEditingAgent.
	 * Agent completion will update status to 'code_review' and populate 'codeDiff'.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @returns {Promise<void>} Resolves when the coding process is queued.
	 */
	startCoding(userId: string, codeTaskId: string): Promise<void>;

	/**
	 * Requests revisions to the generated code based on user review comments.
	 * Sets status back to 'coding'. Asynchronously triggers the CodeEditingAgent with comments.
	 * Agent completion will update status to 'code_review' and update 'codeDiff'.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param data Object containing the review comments/instructions.
	 * @returns {Promise<void>} Resolves when the code revision process is queued.
	 */
	updateCodeWithComments(userId: string, codeTaskId: string, data: UpdateCodeReviewData): Promise<void>;

	/**
	 * Finalizes the Code task: commits the changes, pushes the branch,
	 * and optionally creates a Pull/Merge Request.
	 * Updates codeTask with commit SHA, PR URL (if applicable), and sets status to 'completed' or 'monitoring_ci'.
	 * Requires codeTask status to be 'code_review' (or similar state indicating readiness).
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param data Object containing the final commit title and message.
	 * @returns The final commit SHA and PR URL.
	 */
	commitChanges(userId: string, codeTaskId: string, data: CommitChangesData): Promise<{ commitSha: string; pullRequestUrl?: string }>;

	// --- Helper / Supporting Methods ---

	/**
	 * Retrieves the list of branches for a given repository.
	 * Needed for the UI during codeTask creation.
	 * @param userId The ID of the user making the request.
	 * @param codeTaskId
	 * @param repositorySource The source type ('local', 'github', 'gitlab').
	 * @param repositoryId The specific repository identifier.
	 * @returns A promise resolving to an array of branch names.
	 */
	getBranchList(userId: string, codeTaskId: string, repositorySource: 'local' | 'github' | 'gitlab', repositoryId: string): Promise<string[]>;

	/**
	 * Retrieves the file system tree structure for the checked-out repository within a codeTask's workspace.
	 * Needed for the UI file selection component. Requires the codeTask to be initialized.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param directoryPath The subdirectory to list (optional, defaults to root).
	 * @returns A promise resolving to the FileSystemNode root object.
	 */
	getFileSystemTree(userId: string, codeTaskId: string, directoryPath?: string): Promise<FileSystemNode>;

	/**
	 * Retrieves the content of a specific file within the codeTask's workspace.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @param filePath The path to the file relative to the repository root.
	 * @returns A promise resolving to the file content as a string.
	 */
	getFileContent(userId: string, codeTaskId: string, filePath: string): Promise<string>;

	/**
	 * (Optional) Applies the AI-proposed fix for a CI/CD failure.
	 * May trigger another coding/commit cycle.
	 * @param userId The ID of the user owning the codeTask.
	 * @param codeTaskId The ID of the CodeTask.
	 * @returns {Promise<void>}
	 */
	applyCiCdFix?(userId: string, codeTaskId: string): Promise<void>;
}
