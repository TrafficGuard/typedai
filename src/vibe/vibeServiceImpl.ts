import { randomUUID } from 'node:crypto';
import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { CommitChangesData, CreateVibeSessionData, UpdateCodeReviewData, UpdateVibeSessionData, VibePreset, VibeSession } from '#shared/model/vibe.model';
import type { FileSystemNode } from '#shared/services/fileSystemService';
import { execCommand, failOnError } from '#utils/exec';
import type { VibeDesignGeneration } from '#vibe/vibeDesignGeneration';
import { VibeFileSelection } from '#vibe/vibeFileSelection';
import type { VibeRepository } from '#vibe/vibeRepository';
import { getVibeRepositoryPath } from '#vibe/vibeRepositoryPath';
import type { VibeService } from '#vibe/vibeService';
import { VibeSessionCreation } from '#vibe/vibeSessionCreation';

/**
 * Main implementation of the VibeService.
 * Orchestrates the Vibe workflow, interacting with SCM, agents, filesystem,
 * and the VibeRepository for persistence.
 */
export class VibeServiceImpl implements VibeService {
	private vibeCreation: VibeSessionCreation;
	private vibeFileSelection: VibeFileSelection;
	private vibeDesignGeneration: VibeDesignGeneration;

	constructor(private vibeRepo: VibeRepository) {
		this.vibeCreation = new VibeSessionCreation(vibeRepo);
		this.vibeFileSelection = new VibeFileSelection(vibeRepo);
	}

	// --- Session CRUD (Delegated to Repository) ---

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

	async createVibeSession(userId: string, sessionData: CreateVibeSessionData): Promise<VibeSession> {
		return await this.vibeCreation.createVibeSession(userId, sessionData);
	}

	async updateSelectionWithPrompt(userId: string, sessionId: string, prompt: string): Promise<void> {
		return await this.vibeFileSelection.updateSelectionWithPrompt(userId, sessionId, prompt);
	}

	async generateDetailedDesign(userId: string, sessionId: string, variations = 1): Promise<void> {
		return await this.vibeDesignGeneration.generateDetailedDesign(userId, sessionId, variations);
	}

	async updateDesign(userId: string, sessionId: string, prompt: string): Promise<void> {
		return await this.vibeDesignGeneration.updateDesignWithPrompt(userId, sessionId, prompt);
	}

	async updateDesignFromInstructions(userId: string, sessionId: string, designUpdateInstructions: string): Promise<void> {
		return await this.vibeDesignGeneration.updateDesignFromInstructions(userId, sessionId, designUpdateInstructions);
	}

	async acceptDesign(userId: string, sessionId: string, variations: number): Promise<void> {
		return await this.vibeDesignGeneration.acceptDesign(userId, sessionId, variations);
	}

	async executeDesign(userId: string, sessionId: string): Promise<void> {
		return await this.vibeDesignGeneration.executeDesign(userId, sessionId);
	}

	async startCoding(userId: string, sessionId: string): Promise<void> {
		logger.warn({ userId, sessionId }, '[VibeServiceImpl] startCoding is deprecated, calling executeDesign.');
		await this.executeDesign(userId, sessionId);
	}

	async updateCodeWithComments(userId: string, sessionId: string, data: UpdateCodeReviewData): Promise<void> {
		throw new Error('updateCodeWithComments - Not Implemented');
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

	async getBranchList(userId: string, sessionId: string, providerType: string, projectId: string): Promise<string[]> {
		logger.debug({ userId, sessionId, providerType, projectId }, '[VibeServiceImpl] getBranchList called');

		// Load session for authorization/context, but use providerType/projectId for SCM target
		const session = await this.vibeRepo.getVibeSession(userId, sessionId);
		if (!session) {
			throw new Error(`Vibe session with ID ${sessionId} not found or user not authorized.`);
		}

		if (providerType === 'local') {
			// For 'local', projectId is expected to be the full path to the repository.
			const result = await execCommand('git branch', { workingDirectory: projectId });
			failOnError('Error listing local branches', result);
			return result.stdout
				.trim()
				.split('\n')
				.map((s) => s.trim().replace(/^\* /, '')); // Remove leading '*' from current branch
		}
		if (providerType === 'github') {
			return await new GitHub().getBranches(projectId);
		}
		if (providerType === 'gitlab') {
			return await new GitLab().getBranches(projectId);
		}
		throw new Error(`Unsupported SCM provider type: ${providerType}`);
	}

	async getFileSystemTree(userId: string, sessionId: string, directoryPath?: string): Promise<FileSystemNode> {
		logger.debug({ userId, sessionId, directoryPath }, '[VibeServiceImpl] getFileSystemTree called');
		const vibe = await this.vibeRepo.getVibeSession(userId, sessionId);
		const path = getVibeRepositoryPath(vibe);
		return await new FileSystemService(path).getFileSystemNodes();
	}

	async getFileContent(userId: string, sessionId: string, filePath: string): Promise<string> {
		logger.debug({ userId, sessionId, filePath }, '[VibeServiceImpl] getFileContent called');
		const vibe = await this.vibeRepo.getVibeSession(userId, sessionId);
		const path = getVibeRepositoryPath(vibe);
		return await new FileSystemService(path).readFile(filePath);
	}

	// applyCiCdFix is optional in the interface, so no placeholder needed unless implemented
}
