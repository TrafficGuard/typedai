import { FieldValue } from '@google-cloud/firestore';
import { firestoreDb } from '#firestore/firestore'; // Assuming firestoreDb is available
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

// Basic implementation, needs refinement for actual Firestore logic
export class FirestoreVibeRepository implements VibeService {
	private sessionsCollection(userId: string) {
		return firestoreDb().collection('users').doc(userId).collection('vibeSessions');
	}

	private presetsCollection(userId: string) {
		return firestoreDb().collection('users').doc(userId).collection('vibePresets');
	}

	async createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession> {
		logger.info(sessionData, `Creating Vibe session for user ${userId} [sessionData]`);
		const now = FieldValue.serverTimestamp();
		const newSessionRef = this.sessionsCollection(userId).doc();
		const newSession: Omit<VibeSession, 'id'> = {
			...sessionData,
			userId: userId, // Ensure userId is set
			status: 'initializing',
			lastAgentActivity: Date.now(), // Use current timestamp for now
			createdAt: now as any, // Firestore will set this
			updatedAt: now as any, // Firestore will set this
		};
		await newSessionRef.set(newSession);
		logger.info(`Vibe session created with ID: ${newSessionRef.id}`);

		// TODO: Trigger async initialization process here (e.g., queue a task)
		// this.triggerInitialization(userId, newSessionRef.id);

		// Return the created session data (fetching it back might be better for consistency)
		return { ...newSession, id: newSessionRef.id, createdAt: Date.now(), updatedAt: Date.now() } as VibeSession; // Simulate timestamps for return
	}

	async getVibeSession(userId: string, sessionId: string): Promise<VibeSession | null> {
		const docRef = this.sessionsCollection(userId).doc(sessionId);
		const snapshot = await docRef.get();
		if (!snapshot.exists) {
			return null;
		}
		const data = snapshot.data() as VibeSession;
		// Convert Firestore Timestamps to numbers if necessary for frontend
		return {
			...data,
			id: snapshot.id,
			createdAt: (data.createdAt as any)?.toMillis ? (data.createdAt as any).toMillis() : data.createdAt,
			updatedAt: (data.updatedAt as any)?.toMillis ? (data.updatedAt as any).toMillis() : data.updatedAt,
		};
	}

	async listVibeSessions(userId: string): Promise<VibeSession[]> {
		const snapshot = await this.sessionsCollection(userId).orderBy('createdAt', 'desc').get();
		return snapshot.docs.map((doc) => {
			const data = doc.data() as VibeSession;
			// Convert Firestore Timestamps
			return {
				...data,
				id: doc.id,
				createdAt: (data.createdAt as any)?.toMillis ? (data.createdAt as any).toMillis() : data.createdAt,
				updatedAt: (data.updatedAt as any)?.toMillis ? (data.updatedAt as any).toMillis() : data.updatedAt,
			};
		});
	}

	async updateVibeSession(userId: string, sessionId: string, updates: UpdateVibeSessionData): Promise<void> {
		const docRef = this.sessionsCollection(userId).doc(sessionId);
		// Ensure we don't try to update immutable fields like id, userId, createdAt
		const safeUpdates: Partial<VibeSession> = { ...updates };
		(safeUpdates as any).id = undefined;
		(safeUpdates as any).userId = undefined;
		(safeUpdates as any).createdAt = undefined;
		// Add updatedAt timestamp
		safeUpdates.updatedAt = FieldValue.serverTimestamp() as any;

		// Check if session exists first (optional, update handles non-existence)
		// const session = await this.getVibeSession(userId, sessionId);
		// if (!session) {
		// 	throw new Error(`Vibe session with ID ${sessionId} not found for user ${userId}`);
		// }

		await docRef.update(safeUpdates);
	}

	async deleteVibeSession(userId: string, sessionId: string): Promise<void> {
		const docRef = this.sessionsCollection(userId).doc(sessionId);
		// TODO: Add cleanup logic for associated resources (e.g., workspace directory)
		await docRef.delete();
	}

	// --- Preset Management ---
	async saveVibePreset(userId: string, name: string, config: Omit<CreateVibeSessionData, 'title' | 'instructions'>): Promise<VibePreset> {
		const now = FieldValue.serverTimestamp();
		const newPresetRef = this.presetsCollection(userId).doc();
		const newPreset: Omit<VibePreset, 'id'> = {
			userId: userId,
			name: name,
			config: config,
			createdAt: now as any,
			updatedAt: now as any,
		};
		await newPresetRef.set(newPreset);
		return { ...newPreset, id: newPresetRef.id, createdAt: Date.now(), updatedAt: Date.now() } as VibePreset; // Simulate timestamps
	}

	async listVibePresets(userId: string): Promise<VibePreset[]> {
		const snapshot = await this.presetsCollection(userId).orderBy('createdAt', 'desc').get();
		return snapshot.docs.map((doc) => {
			const data = doc.data() as VibePreset;
			return {
				...data,
				id: doc.id,
				createdAt: (data.createdAt as any)?.toMillis ? (data.createdAt as any).toMillis() : data.createdAt,
				updatedAt: (data.updatedAt as any)?.toMillis ? (data.updatedAt as any).toMillis() : data.updatedAt,
			};
		});
	}

	async deleteVibePreset(userId: string, presetId: string): Promise<void> {
		const docRef = this.presetsCollection(userId).doc(presetId);
		await docRef.delete();
	}

	// --- Workflow Actions (Stubs) ---
	async updateSelectionWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void> {
		// TODO: Implement logic to trigger agent and update status
		logger.warn(`FirestoreVibeRepository.updateSelectionWithPrompt not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'updating_selection' }); // Example status update
		// Simulate agent work and transition back (or to error)
		setTimeout(async () => {
			logger.info(`Simulating completion of updateSelectionWithPrompt for ${sessionId}`);
			await this.updateVibeSession(userId, sessionId, { status: 'file_selection_review' });
		}, 5000); // Simulate delay
	}

	async generateDetailedDesign(userId: string, sessionId: string, variations: number): Promise<void> {
		// TODO: Implement logic to trigger agent and update status
		logger.warn(`FirestoreVibeRepository.generateDetailedDesign not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'generating_design' });
		// Simulate agent work
		setTimeout(async () => {
			logger.info(`Simulating completion of generateDetailedDesign for ${sessionId}`);
			const mockDesign: VibeSession['designAnswer'] = {
				summary: 'Mock design summary',
				steps: ['Step 1', 'Step 2'],
				reasoning: 'Mock reasoning',
			};
			await this.updateVibeSession(userId, sessionId, { status: 'design_review', designAnswer: mockDesign });
		}, 5000);
	}

	async acceptDesign(userId: string, sessionId: string, variations: number): Promise<void> {
		// TODO: Implement logic to update status and potentially trigger next step
		logger.warn(`FirestoreVibeRepository.acceptDesign not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'coding', selectedVariations: variations });
		// Trigger coding agent simulation
		this.executeDesign(userId, sessionId); // Or call startCoding if separate
	}

	async updateDesignWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void> {
		// TODO: Implement logic to trigger agent and update status
		logger.warn(`FirestoreVibeRepository.updateDesignWithPrompt not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'updating_design' });
		// Simulate agent work
		setTimeout(async () => {
			logger.info(`Simulating completion of updateDesignWithPrompt for ${sessionId}`);
			// Update designAnswer based on prompt simulation
			await this.updateVibeSession(userId, sessionId, { status: 'design_review' });
		}, 5000);
	}

	async updateDesignWithInstructions(userId: string, sessionId: string, data: UpdateDesignInstructionsData): Promise<void> {
		// TODO: Implement logic to trigger agent and update status
		logger.warn(`FirestoreVibeRepository.updateDesignWithInstructions not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'updating_design' }); // Or keep in design_review?
		// Simulate agent work
		setTimeout(async () => {
			logger.info(`Simulating completion of updateDesignWithInstructions for ${sessionId}`);
			// Update designAnswer based on instructions simulation
			await this.updateVibeSession(userId, sessionId, { status: 'design_review' });
		}, 5000);
	}

	async executeDesign(userId: string, sessionId: string): Promise<void> {
		// TODO: Implement logic to trigger coding agent and update status
		logger.warn(`FirestoreVibeRepository.executeDesign not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'coding' });
		// Simulate agent work
		setTimeout(async () => {
			logger.info(`Simulating completion of executeDesign (coding) for ${sessionId}`);
			await this.updateVibeSession(userId, sessionId, { status: 'code_review', codeDiff: 'mock diff...' });
		}, 10000);
	}

	async startCoding(userId: string, sessionId: string): Promise<void> {
		// This might be the same as executeDesign or called by it
		logger.warn(`FirestoreVibeRepository.startCoding called, potentially redundant with executeDesign for session ${sessionId}`);
		await this.executeDesign(userId, sessionId); // Delegate for now
	}

	async updateCodeWithComments(userId: string, sessionId: string, data: UpdateCodeReviewData): Promise<void> {
		// TODO: Implement logic to trigger coding agent with comments and update status
		logger.warn(`FirestoreVibeRepository.updateCodeWithComments not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'coding' });
		// Simulate agent work
		setTimeout(async () => {
			logger.info(`Simulating completion of updateCodeWithComments for ${sessionId}`);
			await this.updateVibeSession(userId, sessionId, { status: 'code_review', codeDiff: 'updated mock diff...' });
		}, 10000);
	}

	async commitChanges(userId: string, sessionId: string, data: CommitChangesData): Promise<{ commitSha: string; pullRequestUrl?: string }> {
		// TODO: Implement logic to perform git commit, push, PR creation
		logger.warn(`FirestoreVibeRepository.commitChanges not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'committing' });
		// Simulate commit
		const mockSha = 'mockcommitsha12345';
		await this.updateVibeSession(userId, sessionId, { status: 'completed', commitSha: mockSha }); // Or 'monitoring_ci'
		return { commitSha: mockSha };
	}

	// --- Helper / Supporting Methods (Stubs) ---
	async getBranchList(userId: string, repositorySource: 'local' | 'github' | 'gitlab', repositoryId: string): Promise<string[]> {
		// TODO: Implement actual logic to fetch branches via SCM service or local git commands
		logger.warn(`FirestoreVibeRepository.getBranchList not implemented for repo ${repositoryId}`);
		return ['main', 'develop', 'feature/stub']; // Return mock data
	}

	async getFileSystemTree(userId: string, sessionId: string, directoryPath?: string): Promise<FileSystemNode[]> {
		// TODO: Implement logic to read workspace directory structure
		logger.warn(`FirestoreVibeRepository.getFileSystemTree not implemented for session ${sessionId}`);
		// Return mock data
		return [
			{ path: 'src', name: 'src', type: 'directory', children: [{ path: 'src/index.ts', name: 'index.ts', type: 'file' }] },
			{ path: 'package.json', name: 'package.json', type: 'file' },
		];
	}

	async getFileContent(userId: string, sessionId: string, filePath: string): Promise<string> {
		// TODO: Implement logic to read file content from workspace
		logger.warn(`FirestoreVibeRepository.getFileContent not implemented for session ${sessionId}, path ${filePath}`);
		return `// Mock content for ${filePath}`; // Return mock data
	}

	async applyCiCdFix(userId: string, sessionId: string): Promise<void> {
		// TODO: Implement logic to trigger agent for applying CI/CD fix
		logger.warn(`FirestoreVibeRepository.applyCiCdFix not implemented for session ${sessionId}`);
		await this.updateVibeSession(userId, sessionId, { status: 'coding' }); // Example: Go back to coding
		// Simulate agent work
		setTimeout(async () => {
			logger.info(`Simulating completion of applyCiCdFix for ${sessionId}`);
			await this.updateVibeSession(userId, sessionId, { status: 'code_review', codeDiff: 'cicd fix mock diff...' });
		}, 10000);
	}
}
