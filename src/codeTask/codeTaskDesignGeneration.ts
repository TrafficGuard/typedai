import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/files/files.model';
import { runCodeTaskWorkflowAgent } from './codeTaskAgentRunner';
import type { CodeTaskRepository } from './codeTaskRepository';

export class CodeTaskDesignGeneration {
	constructor(private codeTaskRepo: CodeTaskRepository) {}

	async generateDetailedDesign(userId: string, codeTaskId: string, variations = 1): Promise<void> {
		// Ensure variations is at least 1
		variations = Math.max(1, variations);
		logger.info({ userId, codeTaskId, variations }, '[CodeTaskServiceImpl] generateDetailedDesign called');

		// 1. Get codeTask & validate
		const codeTask = await this.codeTaskRepo.getCodeTask(userId, codeTaskId);
		if (!codeTask) throw new Error(`CodeTask ${codeTaskId} not found for user ${userId}.`);
		if (codeTask.userId !== userId) throw new Error('User not authorized for this codeTask.');
		if (codeTask.status !== 'design_review') {
			throw new Error(`Invalid codeTask status: Cannot generate design in current state '${codeTask.status}'. Expected 'file_selection_review'.`);
		}
		if (!codeTask.fileSelection || codeTask.fileSelection.length === 0) {
			throw new Error('Cannot generate design: File selection is missing or empty.');
		}

		// 2. Update status to 'generating_design' in repo
		logger.info({ codeTaskId }, '[CodeTaskServiceImpl] Updating codeTask status to generating_design...');
		await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, { status: 'generating_design', lastAgentActivity: Date.now() });

		// 3. Trigger agent asynchronously
		const workflow = async () => {
			logger.info({ codeTaskId }, 'Starting background design generation workflow...');
			// Use the codeTask object captured from the outer scope
			const currentCodeTask = codeTask;

			// Placeholder/Mock Design Agent
			const mockGenerateDesignAgent = async (instructions: string, files: SelectedFile[], vars: number): Promise<string> => {
				logger.debug({ codeTaskId, fileCount: files.length, vars }, 'Mock design agent running...');
				await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate work
				return 'Mock Design Summary';
			};

			const designAnswer = await mockGenerateDesignAgent(currentCodeTask.instructions, currentCodeTask.fileSelection!, variations);
			logger.info({ codeTaskId }, 'Mock design agent completed.');

			// Update codeTask on success
			await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, {
				status: 'design_review',
				designAnswer: designAnswer,
				error: null, // Clear previous error
				lastAgentActivity: Date.now(),
			});
			logger.info({ codeTaskId }, 'Successfully generated mock design and updated codeTask status.');
		};

		// Run the workflow using runCodeTaskWorkflowAgent
		runCodeTaskWorkflowAgent(codeTask, 'generateDesign', this.codeTaskRepo, workflow).catch(async (error) => {
			logger.error(error, `[CodeTaskServiceImpl] Error occurred during runCodeTaskWorkflowAgent for design generation codeTask ${codeTaskId}`);
			try {
				await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, {
					status: 'error',
					error: error instanceof Error ? error.message : String(error),
					lastAgentActivity: Date.now(),
				});
			} catch (updateError) {
				logger.error(updateError, `[CodeTaskServiceImpl] Failed to update codeTask ${codeTaskId} status to error after agent runner failure.`);
			}
		});
	}

	async updateDesignWithPrompt(userId: string, codeTaskId: string, prompt: string): Promise<void> {
		logger.info({ userId, codeTaskId, prompt }, '[CodeTaskServiceImpl] updateDesignWithPrompt called');
		// 1. Get codeTask & validate status (e.g., 'design_review_details') & designAnswer exists
		// 2. Update status to 'updating_design' in repo
		// 3. Trigger runDesignGenerationAgent with prompt (async)
		// 4. Agent result callback -> updates repo with new designAnswer & status 'design_review_details' or 'error'
		await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, { status: 'generating_design', lastAgentActivity: Date.now() });

		// Leave as is until instructed to implement this functionality
		throw new Error('updateDesignWithPrompt - Not Implemented');
	}

	async updateDesignFromInstructions(userId: string, codeTaskId: string, designUpdateInstructions: string): Promise<void> {
		logger.info({ userId, codeTaskId, designUpdateInstructions }, '[CodeTaskServiceImpl] updateDesignWithInstructions called');
		// Similar flow to updateDesignWithPrompt, passing structured data to agent
		await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, { status: 'generating_design', lastAgentActivity: Date.now() });

		// Leave as is until instructed to implement this functionality
		throw new Error('updateDesignWithInstructions - Not Implemented');
	}

	async acceptDesign(userId: string, codeTaskId: string, variations: number): Promise<void> {
		logger.info({ userId, codeTaskId, variations }, '[CodeTaskServiceImpl] acceptDesign called');
		try {
			const codeTask = await this.codeTaskRepo.getCodeTask(userId, codeTaskId);
			if (!codeTask) throw new Error(`CodeTask ${codeTaskId} not found for user ${userId}.`);
			// Redundant check if repo enforces user scope, but good practice
			if (codeTask.userId !== userId) throw new Error('User not authorized for this codeTask.');
			if (codeTask.status !== 'design_review') throw new Error(`Invalid codeTask status: Expected 'design_review', got '${codeTask.status}'.`);

			await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, {
				status: 'coding',
				lastAgentActivity: Date.now(),
			});
			logger.info({ codeTaskId }, 'CodeTask status updated to coding and variations stored.');

			// Trigger the coding agent
			await this.executeDesign(userId, codeTaskId);
			logger.info({ codeTaskId }, 'executeDesign triggered.');
		} catch (error) {
			logger.error(error, `[CodeTaskServiceImpl] Failed to accept design for codeTask ${codeTaskId}`);
			// Optionally update codeTask status to error here if appropriate
			throw error; // Re-throw the error to be handled by the caller
		}
	}

	async executeDesign(userId: string, codeTaskId: string): Promise<void> {
		logger.info({ userId, codeTaskId }, '[CodeTaskServiceImpl] executeDesign called');
		// 1. Get codeTask & validate status (e.g., 'design_review' or 'design_review_details') & designAnswer/fileSelection exist
		// 2. Update status to 'coding' in repo
		// 3. Trigger runCodeEditingAgent (async)
		// 4. Agent result callback -> updates repo with codeDiff & status 'code_review' or 'error'
		await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, { status: 'coding', lastAgentActivity: Date.now() });

		// Leave as is until instructed to implement this functionality
		throw new Error('executeDesign - Not Implemented');
	}
}
