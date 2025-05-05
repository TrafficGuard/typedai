import { randomUUID } from 'node:crypto';
import { logger } from '#o11y/logger';
import type { VibeService } from '#vibe/vibeService';
import type {
	CommitChangesData,
	CreateVibeSessionData,
	FileSystemNode,
	UpdateCodeReviewData,
	UpdateDesignInstructionsData,
	UpdateVibeSessionData,
	VibePreset,
	VibeSession,
} from '#vibe/vibeTypes';

export class InMemoryVibeRepository implements VibeService {
	private sessions: Map<string, VibeSession> = new Map();
	private presets: Map<string, VibePreset> = new Map();

	// Helper to filter by user
	private getUserSessions(userId: string): VibeSession[] {
		return Array.from(this.sessions.values()).filter((s) => s.userId === userId);
	}

	private getUserPresets(userId: string): VibePreset[] {
		return Array.from(this.presets.values()).filter((p) => p.userId === userId);
	}

	async createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession> {
		logger.info(sessionData, `Creating Vibe session for user ${userId} [sessionData]`);
		const newId = randomUUID();
		const now = Date.now();
		const newSession: VibeSession = {
			...sessionData,
			id: newId,
			userId: userId,
			status: 'initializing',
			lastAgentActivity: now,
			createdAt: now,
			updatedAt: now,
		};
		this.sessions.set(newId, newSession);
		logger.info(`Vibe session created with ID: ${newId}`);

		// Simulate async initialization
		setTimeout(() => {
			const session = this.sessions.get(newId);
			if (session && session.status === 'initializing') {
				logger.info(`Simulating completion of initialization for ${newId}`);
				session.status = 'file_selection_review'; // Move to next state
				session.fileSelection = [{ filePath: 'src/mockFile.ts', reason: 'Initial mock selection' }];
				session.designAnswer = { summary: 'Mock design', steps: ['Step 1'], reasoning: 'Mock reason' };
				session.updatedAt = Date.now();
			}
		}, 3000); // Simulate 3 second delay

		return { ...newSession }; // Return a copy
	}

	async getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		const session = this.sessions.get(sessionId);
		if (session && session.userId === userId) {
			return { ...session }; // Return a copy
		}
		return null;
	}

	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		return this.getUserSessions(userId)
			.map((s) => ({ ...s })) // Return copies
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	async updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || session.userId !== userId) {
			throw new Error(`Vibe session with ID ${sessionId} not found for user ${userId}`);
		}

		// Apply updates, ensuring immutable fields aren't changed
		const currentId = session.id;
		const currentUserId = session.userId;
		const currentCreatedAt = session.createdAt;

		Object.assign(session, updates);

		// Restore immutable fields if accidentally overwritten
		session.id = currentId;
		session.userId = currentUserId;
		session.createdAt = currentCreatedAt;
		session.updatedAt = Date.now(); // Update timestamp
	}

	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session && session.userId === userId) {
			this.sessions.delete(sessionId);
			// TODO: Add cleanup logic if needed for in-memory (e.g., associated data)
		} else {
			throw new Error(`Vibe session with ID ${sessionId} not found for user ${userId}`);
		}
	}

	// --- Preset Management ---
	async saveVibePreset(userId: string, name: string, config: Omit<CreateVibeSessionData, 'title' | 'instructions'>): Promise<VibePreset> {
		const newId = randomUUID();
		const now = Date.now();
		const newPreset: VibePreset = {
			id: newId,
			userId: userId,
			name: name,
			config: config,
			createdAt: now,
			updatedAt: now,
		};
		this.presets.set(newId, newPreset);
		return { ...newPreset }; // Return a copy
	}

	async listVibePresets(userId: string): Promise<VibePreset[]> {
		return this.getUserPresets(userId)
			.map((p) => ({ ...p })) // Return copies
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	async deleteVibePreset(userId: string, presetId: string): Promise<void> {
		const preset = this.presets.get(presetId);
		if (preset && preset.userId === userId) {
			this.presets.delete(presetId);
		} else {
			throw new Error(`Vibe preset with ID ${presetId} not found for user ${userId}`);
		}
	}

	// --- Workflow Actions (Stubs) ---
	async updateSelectionWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void> {
		logger.warn(`InMemoryVibeRepository.updateSelectionWithPrompt not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'updating_selection' });
		// Simulate agent work
		setTimeout(async () => {
			try {
				logger.info(`Simulating completion of updateSelectionWithPrompt for ${sessionId}`);
				await this.updateVibeSession(userId, sessionId, { status: 'file_selection_review' });
			} catch (e) {
				logger.error(e, `Error during simulated updateSelectionWithPrompt completion for ${sessionId}`);
			}
		}, 3000);
	}

	async generateDetailedDesign(userId: string, sessionId: string, variations: number): Promise<void> {
		logger.warn(`InMemoryVibeRepository.generateDetailedDesign not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'generating_design' });
		// Simulate agent work
		setTimeout(async () => {
			try {
				logger.info(`Simulating completion of generateDetailedDesign for ${sessionId}`);
				const mockDesign: VibeSession['designAnswer'] = {
					summary: `Mock design summary (variations: ${variations})`,
					steps: ['Step 1', 'Step 2'],
					reasoning: 'Mock reasoning',
				};
				await this.updateVibeSession(userId, sessionId, { status: 'design_review', designAnswer: mockDesign });
			} catch (e) {
				logger.error(e, `Error during simulated generateDetailedDesign completion for ${sessionId}`);
			}
		}, 3000);
	}

	async acceptDesign(userId: string, sessionId: string, variations: number): Promise<void> {
		logger.warn(`InMemoryVibeRepository.acceptDesign not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'coding', selectedVariations: variations });
		// Simulate triggering coding
		this.executeDesign(userId, sessionId);
	}

	async updateDesign(userId: string, sessionId: string, prompt: string): Promise<void> {
		logger.warn(`InMemoryVibeRepository.updateDesignWithPrompt not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'updating_design' });
		// Simulate agent work
		setTimeout(async () => {
			try {
				logger.info(`Simulating completion of updateDesignWithPrompt for ${sessionId}`);
				await this.updateVibeSession(userId, sessionId, { status: 'design_review' });
			} catch (e) {
				logger.error(e, `Error during simulated updateDesignWithPrompt completion for ${sessionId}`);
			}
		}, 3000);
	}

	async updateDesignFromInstructions(userId: string, sessionId: string, data: UpdateDesignInstructionsData): Promise<void> {
		logger.warn(`InMemoryVibeRepository.updateDesignWithInstructions not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'updating_design' });
		// Simulate agent work
		setTimeout(async () => {
			try {
				logger.info(`Simulating completion of updateDesignWithInstructions for ${sessionId}`);
				await this.updateVibeSession(userId, sessionId, { status: 'design_review' });
			} catch (e) {
				logger.error(e, `Error during simulated updateDesignWithInstructions completion for ${sessionId}`);
			}
		}, 3000);
	}

	async executeDesign(userId: string, sessionId: string): Promise<void> {
		logger.warn(`InMemoryVibeRepository.executeDesign not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'coding' });
		// Simulate agent work
		setTimeout(async () => {
			try {
				logger.info(`Simulating completion of executeDesign (coding) for ${sessionId}`);
				await this.updateVibeSession(userId, sessionId, { status: 'code_review', codeDiff: 'in-memory mock diff...' });
			} catch (e) {
				logger.error(e, `Error during simulated executeDesign completion for ${sessionId}`);
			}
		}, 5000);
	}

	async startCoding(userId: string, sessionId: string): Promise<void> {
		logger.warn(`InMemoryVibeRepository.startCoding called, potentially redundant with executeDesign for session ${sessionId}`);
		await this.executeDesign(userId, sessionId); // Delegate
	}

	async updateCodeWithComments(userId: string, sessionId: string, data: UpdateCodeReviewData): Promise<void> {
		logger.warn(`InMemoryVibeRepository.updateCodeWithComments not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'coding' });
		// Simulate agent work
		setTimeout(async () => {
			try {
				logger.info(`Simulating completion of updateCodeWithComments for ${sessionId}`);
				await this.updateVibeSession(userId, sessionId, { status: 'code_review', codeDiff: 'updated in-memory mock diff...' });
			} catch (e) {
				logger.error(e, `Error during simulated updateCodeWithComments completion for ${sessionId}`);
			}
		}, 5000);
	}

	async commitChanges(userId: string, sessionId: string, data: CommitChangesData): Promise<{ commitSha: string; pullRequestUrl?: string }> {
		logger.warn(`InMemoryVibeRepository.commitChanges not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'committing' });
		// Simulate commit
		const mockSha = `memcommit-${randomUUID().substring(0, 8)}`;
		await this.updateVibeSession(userId, sessionId, { status: 'completed', commitSha: mockSha }); // Or 'monitoring_ci'
		return { commitSha: mockSha };
	}

	// --- Helper / Supporting Methods (Stubs) ---
	async getBranchList(userId: string, repositorySource: 'local' | 'github' | 'gitlab', repositoryId: string): Promise<string[]> {
		logger.warn(`InMemoryVibeRepository.getBranchList not implemented for repo ${repositoryId}`);
		return ['main', 'develop', 'feature/memory-stub']; // Return mock data
	}

	async getFileSystemTree(userId: string, sessionId: string, directoryPath?: string): Promise<FileSystemNode[]> {
		logger.warn(`InMemoryVibeRepository.getFileSystemTree not implemented for session ${sessionId}`);
		// Return mock data
		return [
			{ path: 'src', name: 'src', type: 'directory', children: [{ path: 'src/mem-index.ts', name: 'mem-index.ts', type: 'file' }] },
			{ path: 'mem-package.json', name: 'mem-package.json', type: 'file' },
		];
	}

	async getFileContent(userId: string, sessionId: string, filePath: string): Promise<string> {
		logger.warn(`InMemoryVibeRepository.getFileContent not implemented for session ${sessionId}, path ${filePath}`);
		return `// In-memory mock content for ${filePath}`; // Return mock data
	}

	async applyCiCdFix(userId: string, sessionId: string): Promise<void> {
		logger.warn(`InMemoryVibeRepository.applyCiCdFix not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'coding' }); // Example: Go back to coding
		// Simulate agent work
		setTimeout(async () => {
			try {
				logger.info(`Simulating completion of applyCiCdFix for ${sessionId}`);
				await this.updateVibeSession(userId, sessionId, { status: 'code_review', codeDiff: 'in-memory cicd fix mock diff...' });
			} catch (e) {
				logger.error(e, `Error during simulated applyCiCdFix completion for ${sessionId}`);
			}
		}, 5000);
	}
}
