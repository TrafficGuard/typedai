import { agentContextStorage } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import { type SelectedFile as OriginalSelectedFile, selectFilesAgent } from '#swe/discovery/selectFilesAgent';
import { runVibeWorkflowAgent } from '#vibe/vibeAgentRunner';
import type { VibeRepository } from '#vibe/vibeRepository';
import type { SelectedFile, VibeSession } from '#vibe/vibeTypes';

export class VibeFileSelection {
	constructor(private vibeRepo: VibeRepository) {}

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

		// 2. Update status to 'updating_file_selection' in repo
		logger.info({ sessionId }, '[VibeServiceImpl] Updating session status to updating_selection...');
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'updating_file_selection', lastAgentActivity: Date.now() });

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
				path: sf.filePath, // Map 'filePath' to 'path' TODO should make the properties the same name
				reason: sf.reason,
				category: sf.category,
				readOnly: sf.readOnly,
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
				category: sf.category,
				readOnly: sf.readOnly, // Map 'readonly' back to 'readOnly'
			}));
			logger.info({ sessionId, count: mappedResult.length }, 'selectFilesAgent completed and result mapped within workflow.');

			let updateData: Partial<VibeSession>; // Using Partial<VibeSession> which aligns with UpdateVibeSessionData structure
			if (mappedResult && mappedResult.length > 0) {
				logger.info({ sessionId, count: mappedResult.length }, 'AI selected files for review.');
				updateData = {
					originalFileSelectionForReview: JSON.parse(JSON.stringify(mappedResult)), // Deep copy for safety
					fileSelection: JSON.parse(JSON.stringify(mappedResult)), // Deep copy for safety
					status: 'file_selection_review',
					error: null, // Clear any previous error
					lastAgentActivity: Date.now(),
				};
			} else {
				logger.warn({ sessionId }, 'AI did not select any files, or an error occurred during selection.');
				updateData = {
					originalFileSelectionForReview: [],
					fileSelection: [],
					status: 'file_selection_review', // Review empty selection
					error: null, // Assuming no error if empty is a valid review state
					lastAgentActivity: Date.now(),
				};
			}

			// Update Repo (Success) - Use userId and sessionId from outer scope
			await this.vibeRepo.updateVibeSession(userId, sessionId, updateData);
			logger.info({ sessionId }, 'Successfully updated file selection and status within workflow.');
		};

		// Run the workflow using runVibeWorkflowAgent
		// This handles setting up the agent context, running the workflow, and basic error handling/logging
		runVibeWorkflowAgent(session, 'updateFileSelection', this.vibeRepo, workflow).catch((error) => {
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
}
