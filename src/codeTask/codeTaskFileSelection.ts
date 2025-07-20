import { agentContextStorage } from '#agent/agentContextLocalStorage';
import { logger } from '#o11y/logger';
import type { CodeTask } from '#shared/codeTask/codeTask.model';
import type { SelectedFile } from '#shared/files/files.model';
import { selectFilesAgent } from '#swe/discovery/selectFilesAgentWithSearch';
import { runCodeTaskWorkflowAgent } from './codeTaskAgentRunner';
import type { CodeTaskRepository } from './codeTaskRepository';

export class CodeTaskFileSelection {
	constructor(private codeTaskRepo: CodeTaskRepository) {}

	async updateSelectionWithPrompt(userId: string, codeTaskId: string, prompt: string): Promise<void> {
		logger.info({ userId, codeTaskId, prompt }, '[CodeTaskServiceImpl] updateSelectionWithPrompt called');
		// 1. Get codeTask & validate
		logger.debug({ userId, codeTaskId }, '[CodeTaskServiceImpl] Getting codeTask for selection update...');
		const codeTask = await this.codeTaskRepo.getCodeTask(userId, codeTaskId);
		if (!codeTask) throw new Error(`CodeTask ${codeTaskId} not found for user ${userId}.`);
		if (codeTask.userId !== userId) throw new Error('User not authorized for this codeTask.'); // Redundant check if repo enforces scope, but good practice
		if (codeTask.status !== 'design_review') {
			throw new Error(`Invalid codeTask status: Cannot update selection in current state '${codeTask.status}'. Expected 'file_selection_review'.`);
		}

		// 2. Update status to 'updating_file_selection' in repo
		logger.info({ codeTaskId }, '[CodeTaskServiceImpl] Updating codeTask status to updating_selection...');
		await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, { status: 'generating_design', lastAgentActivity: Date.now() });

		// 3. Trigger agent asynchronously using runCodeTaskWorkflowAgent
		logger.info({ codeTaskId }, '[CodeTaskServiceImpl] Triggering background agent for file selection update via runCodeTaskWorkflowAgent.');
		// No await - runs in background
		this._runFileSelectionUpdateAgent(userId, codeTask, prompt);
	}

	/**
	 * Runs the file selection agent asynchronously using runCodeTaskWorkflowAgent.
	 */
	private _runFileSelectionUpdateAgent(userId: string, codeTask: CodeTask, prompt: string): void {
		const codeTaskId = codeTask.id;
		logger.info({ userId, codeTaskId }, '[CodeTaskServiceImpl] Scheduling background file selection update agent via runCodeTaskWorkflowAgent...');

		// Define the workflow function to be executed by the agent runner
		const workflow = async () => {
			// Agent context is available here via agentContext() which is set by runCodeTaskWorkflowAgent
			const currentAgentContext = agentContextStorage.getStore(); // Get the full context
			if (!currentAgentContext) throw new Error('Agent context not available in workflow.');
			// We don't need to manually set up FSS or user context here, it's provided by the runner.

			// Prepare inputs using codeTask data and prompt
			const instructions = codeTask.instructions;
			const currentSelection: SelectedFile[] = codeTask.fileSelection || [];

			logger.debug({ codeTaskId }, 'Preparing inputs for selectFilesAgent within workflow...');

			const prompt = `<original-instruction>${instructions}</original-instruction>\n\n# Update instructions\n${instructions}`;
			const updatedFileSelection = await selectFilesAgent(prompt, { initialFiles: currentSelection });
			if (!updatedFileSelection || !Array.isArray(updatedFileSelection)) throw new Error('Invalid response structure from selectFilesAgent during update.');

			logger.info({ codeTaskId, count: updatedFileSelection.length }, 'selectFilesAgent completed and result mapped within workflow.');

			let updateData: Partial<CodeTask>;
			if (updatedFileSelection && updatedFileSelection.length > 0) {
				logger.info({ codeTaskId, count: updatedFileSelection.length }, 'AI selected files for review.');
				updateData = {
					fileSelection: JSON.parse(JSON.stringify(updatedFileSelection)),
					status: 'design_review',
					error: null,
					lastAgentActivity: Date.now(),
				};
			} else {
				logger.warn({ codeTaskId }, 'AI did not select any files, or an error occurred during selection.');
				updateData = {
					fileSelection: [],
					status: 'design_review', // Review empty selection
					error: null, // Assuming no error if empty is a valid review state
					lastAgentActivity: Date.now(),
				};
			}

			// Update Repo (Success) - Use userId and codeTaskId from outer scope
			await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, updateData);
			logger.info({ codeTaskId }, 'Successfully updated file selection and status within workflow.');
		};

		// Run the workflow using runCodeTaskWorkflowAgent
		// This handles setting up the agent context, running the workflow, and basic error handling/logging
		runCodeTaskWorkflowAgent(codeTask, 'updateFileSelection', this.codeTaskRepo, workflow).catch((error) => {
			// Catch errors specifically from the runCodeTaskWorkflowAgent promise itself
			// (e.g., if the agent runner fails to start)
			// Errors *within* the workflow are typically handled by the runner or the workflow itself
			logger.error(error, `[CodeTaskServiceImpl] Error occurred during runCodeTaskWorkflowAgent for codeTask ${codeTaskId}`);
			// Attempt to update codeTask status to error
			this.codeTaskRepo
				.updateCodeTask(userId, codeTaskId, {
					status: 'error',
					error: error instanceof Error ? error.message : String(error),
					lastAgentActivity: Date.now(),
				})
				.catch((updateError) => {
					logger.error(updateError, `[CodeTaskServiceImpl] Failed to update codeTask ${codeTaskId} status to error after agent runner failure.`);
				});
		});
	}
}
