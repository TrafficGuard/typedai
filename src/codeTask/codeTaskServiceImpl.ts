import { randomUUID } from 'node:crypto';
import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type {
	CodeTask,
	CodeTaskPreset,
	CommitChangesData,
	CreateCodeTaskData,
	UpdateCodeReviewData,
	UpdateCodeTaskData,
} from '#shared/codeTask/codeTask.model';
import type { FileSystemNode } from '#shared/files/fileSystemService';
import { execCommand, failOnError } from '#utils/exec';
import { CodeTaskCreation } from './codeTaskCreation';
import type { CodeTaskDesignGeneration } from './codeTaskDesignGeneration';
import { CodeTaskFileSelection } from './codeTaskFileSelection';
import type { CodeTaskRepository } from './codeTaskRepository';
import { getCodeTaskRepositoryPath } from './codeTaskRepositoryPath';
import type { CodeTaskService } from './codeTaskService';

/**
 * Main implementation of the CodeTaskService.
 * Orchestrates the CodeTask workflow, interacting with SCM, agents, filesystem,
 * and the CodeTaskRepository for persistence.
 */
export class CodeTaskServiceImpl implements CodeTaskService {
	private codeTaskCreation: CodeTaskCreation;
	private codeTaskFileSelection: CodeTaskFileSelection;
	private codeTaskDesignGeneration: CodeTaskDesignGeneration;

	constructor(private codeTaskRepo: CodeTaskRepository) {
		this.codeTaskCreation = new CodeTaskCreation(codeTaskRepo);
		this.codeTaskFileSelection = new CodeTaskFileSelection(codeTaskRepo);
	}

	// --- CodeTask CRUD (Delegated to Repository) ---

	async getCodeTask(userId: string, codeTaskId: string): Promise<CodeTask | null> {
		logger.debug({ userId, codeTaskId }, '[CodeTaskServiceImpl] Getting codeTask...');
		// Authorization might be checked here or rely on repository/user context
		return this.codeTaskRepo.getCodeTask(userId, codeTaskId);
	}

	async listCodeTasks(userId: string): Promise<CodeTask[]> {
		logger.debug({ userId }, '[CodeTaskServiceImpl] Listing codeTasks...');
		return this.codeTaskRepo.listCodeTasks(userId);
	}

	async updateCodeTask(userId: string, codeTaskId: string, updates: UpdateCodeTaskData): Promise<void> {
		logger.debug({ userId, codeTaskId, updates }, '[CodeTaskServiceImpl] Updating codeTask...');
		// Add validation or business logic before updating if needed
		await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, updates);
	}

	async deleteCodeTask(userId: string, codeTaskId: string): Promise<void> {
		logger.info({ userId, codeTaskId }, '[CodeTaskServiceImpl] Deleting codeTask...');
		// TODO: Implement workspace cleanup logic (e.g., delete cloned repo directory)
		logger.info({ codeTaskId }, '[CodeTaskServiceImpl] Cleaning up workspace (placeholder)...');
		await this.codeTaskRepo.deleteCodeTask(userId, codeTaskId);
		logger.info({ codeTaskId }, '[CodeTaskServiceImpl] CodeTask deleted from repository.');
	}

	// --- Preset CRUD (Delegated to Repository) ---

	async saveCodeTaskPreset(userId: string, name: string, config: Omit<CreateCodeTaskData, 'title' | 'instructions'>): Promise<CodeTaskPreset> {
		logger.info({ userId, name }, '[CodeTaskServiceImpl] Saving preset...');
		const presetId = randomUUID();
		const now = Date.now();
		const newPreset: CodeTaskPreset = {
			id: presetId,
			userId: userId,
			name: name,
			config: config,
			createdAt: now,
			updatedAt: now,
		};
		await this.codeTaskRepo.saveCodeTaskPreset(newPreset);
		return { ...newPreset };
	}

	async listCodeTaskPresets(userId: string): Promise<CodeTaskPreset[]> {
		logger.debug({ userId }, '[CodeTaskServiceImpl] Listing presets...');
		return this.codeTaskRepo.listCodeTaskPresets(userId);
	}

	async deleteCodeTaskPreset(userId: string, presetId: string): Promise<void> {
		logger.info({ userId, presetId }, '[CodeTaskServiceImpl] Deleting preset...');
		await this.codeTaskRepo.deleteCodeTaskPreset(userId, presetId);
	}

	// --- Workflow Orchestration Actions ---

	async createCodeTask(userId: string, codeTaskData: CreateCodeTaskData): Promise<CodeTask> {
		return await this.codeTaskCreation.createCodeTask(userId, codeTaskData);
	}

	async updateSelectionWithPrompt(userId: string, codeTaskId: string, prompt: string): Promise<void> {
		return await this.codeTaskFileSelection.updateSelectionWithPrompt(userId, codeTaskId, prompt);
	}

	async generateDetailedDesign(userId: string, codeTaskId: string, variations = 1): Promise<void> {
		return await this.codeTaskDesignGeneration.generateDetailedDesign(userId, codeTaskId, variations);
	}

	async updateDesign(userId: string, codeTaskId: string, prompt: string): Promise<void> {
		return await this.codeTaskDesignGeneration.updateDesignWithPrompt(userId, codeTaskId, prompt);
	}

	async updateDesignFromInstructions(userId: string, codeTaskId: string, designUpdateInstructions: string): Promise<void> {
		return await this.codeTaskDesignGeneration.updateDesignFromInstructions(userId, codeTaskId, designUpdateInstructions);
	}

	async acceptDesign(userId: string, codeTaskId: string, variations: number): Promise<void> {
		return await this.codeTaskDesignGeneration.acceptDesign(userId, codeTaskId, variations);
	}

	async executeDesign(userId: string, codeTaskId: string): Promise<void> {
		return await this.codeTaskDesignGeneration.executeDesign(userId, codeTaskId);
	}

	async startCoding(userId: string, codeTaskId: string): Promise<void> {
		logger.warn({ userId, codeTaskId }, '[CodeTaskServiceImpl] startCoding is deprecated, calling executeDesign.');
		await this.executeDesign(userId, codeTaskId);
	}

	async updateCodeWithComments(userId: string, codeTaskId: string, data: UpdateCodeReviewData): Promise<void> {
		throw new Error('updateCodeWithComments - Not Implemented');
	}

	async commitChanges(userId: string, codeTaskId: string, data: CommitChangesData): Promise<{ commitSha: string; pullRequestUrl?: string }> {
		logger.info({ userId, codeTaskId, data }, '[CodeTaskServiceImpl] commitChanges called');
		// 1. Get codeTask & validate status (e.g., 'code_review')
		// 2. Update status to 'committing' in repo
		// 3. Perform SCM operations: commit, push, create PR/MR (using SCM service/library)
		// 4. Update repo with commitSha, pullRequestUrl, status 'completed' or 'monitoring_ci' or 'error'
		await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, { status: 'committing', lastAgentActivity: Date.now() });
		logger.warn('[CodeTaskServiceImpl] commitChanges - SCM operations not implemented.');
		await new Promise((resolve) => setTimeout(resolve, 500));
		// Simulate success for now
		const result = { commitSha: `impl-sha-${randomUUID().substring(0, 8)}`, pullRequestUrl: undefined };
		await this.codeTaskRepo.updateCodeTask(userId, codeTaskId, {
			status: 'completed',
			commitSha: result.commitSha,
			pullRequestUrl: result.pullRequestUrl,
			lastAgentActivity: Date.now(),
		});
		return result;
		// throw new Error('commitChanges - Not Implemented');
	}

	// --- Helper / Supporting Methods ---

	async getBranchList(userId: string, codeTaskId: string, providerType: string, projectId: string): Promise<string[]> {
		logger.debug({ userId, codeTaskId, providerType, projectId }, '[CodeTaskServiceImpl] getBranchList called');

		// Load codeTask for authorization/context, but use providerType/projectId for SCM target
		const codeTask = await this.codeTaskRepo.getCodeTask(userId, codeTaskId);
		if (!codeTask) {
			throw new Error(`Code task with ID ${codeTaskId} not found or user not authorized.`);
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

	async getFileSystemTree(userId: string, codeTaskId: string, directoryPath?: string): Promise<FileSystemNode> {
		logger.debug({ userId, codeTaskId, directoryPath }, '[CodeTaskServiceImpl] getFileSystemTree called');
		const codeTask = await this.codeTaskRepo.getCodeTask(userId, codeTaskId);
		const path = getCodeTaskRepositoryPath(codeTask);
		return await new FileSystemService(path).getFileSystemNodes();
	}

	async getFileContent(userId: string, codeTaskId: string, filePath: string): Promise<string> {
		logger.debug({ userId, codeTaskId, filePath }, '[CodeTaskServiceImpl] getFileContent called');
		const codeTask = await this.codeTaskRepo.getCodeTask(userId, codeTaskId);
		const path = getCodeTaskRepositoryPath(codeTask);
		return await new FileSystemService(path).readFile(filePath);
	}

	// applyCiCdFix is optional in the interface, so no placeholder needed unless implemented
}
