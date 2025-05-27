import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/model/files.model';
import { runVibeWorkflowAgent } from '#vibe/vibeAgentRunner';
import type { VibeRepository } from '#vibe/vibeRepository';

export class VibeDesignGeneration {
	constructor(private vibeRepo: VibeRepository) {}

	async generateDetailedDesign(userId: string, sessionId: string, variations = 1): Promise<void> {
		// Ensure variations is at least 1
		variations = Math.max(1, variations);
		logger.info({ userId, sessionId, variations }, '[VibeServiceImpl] generateDetailedDesign called');

		// 1. Get session & validate
		const session = await this.vibeRepo.getVibeSession(userId, sessionId);
		if (!session) throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
		if (session.userId !== userId) throw new Error('User not authorized for this session.');
		if (session.status !== 'design_review') {
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
			const mockGenerateDesignAgent = async (instructions: string, files: SelectedFile[], vars: number): Promise<string> => {
				logger.debug({ sessionId, fileCount: files.length, vars }, 'Mock design agent running...');
				await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate work
				return 'Mock Design Summary';
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
		runVibeWorkflowAgent(session, 'generateDesign', this.vibeRepo, workflow).catch(async (error) => {
			logger.error(error, `[VibeServiceImpl] Error occurred during runVibeWorkflowAgent for design generation session ${sessionId}`);
			try {
				await this.vibeRepo.updateVibeSession(userId, sessionId, {
					status: 'error',
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
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'generating_design', lastAgentActivity: Date.now() });

		// Leave as is until instructed to implement this functionality
		throw new Error('updateDesignWithPrompt - Not Implemented');
	}

	async updateDesignFromInstructions(userId: string, sessionId: string, designUpdateInstructions: string): Promise<void> {
		logger.info({ userId, sessionId, designUpdateInstructions }, '[VibeServiceImpl] updateDesignWithInstructions called');
		// Similar flow to updateDesignWithPrompt, passing structured data to agent
		await this.vibeRepo.updateVibeSession(userId, sessionId, { status: 'generating_design', lastAgentActivity: Date.now() });

		// Leave as is until instructed to implement this functionality
		throw new Error('updateDesignWithInstructions - Not Implemented');
	}

	async acceptDesign(userId: string, sessionId: string, variations: number): Promise<void> {
		logger.info({ userId, sessionId, variations }, '[VibeServiceImpl] acceptDesign called');
		try {
			const session = await this.vibeRepo.getVibeSession(userId, sessionId);
			if (!session) throw new Error(`VibeSession ${sessionId} not found for user ${userId}.`);
			// Redundant check if repo enforces user scope, but good practice
			if (session.userId !== userId) throw new Error('User not authorized for this session.');
			if (session.status !== 'design_review') throw new Error(`Invalid session status: Expected 'design_review', got '${session.status}'.`);

			await this.vibeRepo.updateVibeSession(userId, sessionId, {
				status: 'coding',
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

		// Leave as is until instructed to implement this functionality
		throw new Error('executeDesign - Not Implemented');
	}
}
