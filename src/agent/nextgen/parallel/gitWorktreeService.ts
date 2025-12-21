/**
 * Git Worktree Service
 *
 * Manages git worktrees for parallel option exploration.
 * Each worktree allows implementing an option on a separate branch
 * without switching branches in the main working directory.
 *
 * Features:
 * - Create worktrees for parallel implementation
 * - Persist worktree state for recovery after process restart
 * - Re-checkout branches when worktree folders are cleaned up
 */

import { access, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '#o11y/logger';
import { arg, execCommand, failOnError } from '#utils/exec';
import { WorktreePersistence, type WorktreeState } from './worktreePersistence';

// ============================================================================
// Worktree Types
// ============================================================================

/**
 * Represents a git worktree
 */
export interface Worktree {
	/** Unique worktree ID */
	id: string;
	/** Absolute path to the worktree directory */
	path: string;
	/** Branch name in this worktree */
	branch: string;
	/** Option ID this worktree is implementing */
	optionId: string;
	/** Creation timestamp */
	createdAt: number;
	/** Whether the worktree is active */
	active: boolean;
}

/**
 * Configuration for worktree service
 */
export interface GitWorktreeServiceConfig {
	/** Main repository working directory */
	repoPath: string;
	/** Task ID for persistence */
	taskId: string;
	/** Base directory for worktrees (default: system temp) */
	worktreeBaseDir?: string;
	/** Prefix for worktree directories */
	worktreePrefix?: string;
}

/**
 * Options for creating a worktree
 */
export interface CreateWorktreeOptions {
	/** Option ID this worktree is for */
	optionId: string;
	/** Branch name to create */
	branch: string;
	/** Base branch/commit to branch from */
	base?: string;
	/** Feature ID (for persistence/recovery) */
	featureId?: string;
}

// ============================================================================
// Git Worktree Service Implementation
// ============================================================================

/**
 * Service for managing git worktrees
 */
export class GitWorktreeService {
	private config: Required<GitWorktreeServiceConfig>;
	private worktrees: Map<string, Worktree> = new Map();
	private persistence: WorktreePersistence;
	private initialized = false;

	constructor(config: GitWorktreeServiceConfig) {
		this.config = {
			repoPath: config.repoPath,
			taskId: config.taskId,
			worktreeBaseDir: config.worktreeBaseDir ?? join(tmpdir(), 'typedai-worktrees'),
			worktreePrefix: config.worktreePrefix ?? 'wt',
		};
		this.persistence = new WorktreePersistence(config.repoPath, config.taskId);
	}

	// ===========================================================================
	// Initialization & Recovery
	// ===========================================================================

	/**
	 * Initialize the service and recover any persisted worktree state.
	 * Call this before using the service to restore state after process restart.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		const checkpoint = await this.persistence.load();
		if (!checkpoint) {
			this.initialized = true;
			return;
		}

		logger.info({ taskId: this.config.taskId, worktreeCount: checkpoint.worktrees.length }, 'Recovering worktree state');

		for (const state of checkpoint.worktrees) {
			if (!state.active) continue;

			// Check if folder still exists
			if (await this.folderExists(state.path)) {
				// Reuse existing worktree
				logger.debug({ worktreeId: state.id, path: state.path }, 'Reusing existing worktree');
				this.worktrees.set(state.id, this.stateToWorktree(state));
			} else {
				// Folder cleaned up - check if branch exists and re-checkout
				const branchExists = await this.branchExists(state.branch);
				if (branchExists) {
					logger.info({ worktreeId: state.id, branch: state.branch }, 'Re-checking out branch into new worktree');
					try {
						const worktree = await this.checkoutExistingBranch(state.branch, state.optionId, state.featureId);
						this.worktrees.set(worktree.id, worktree);
					} catch (error) {
						logger.error({ error, worktreeId: state.id, branch: state.branch }, 'Failed to recover worktree');
					}
				} else {
					logger.warn({ worktreeId: state.id, branch: state.branch }, 'Branch no longer exists, skipping recovery');
				}
			}
		}

		// Save updated state
		await this.persistState();
		this.initialized = true;
		logger.info({ recoveredCount: this.worktrees.size }, 'Worktree recovery complete');
	}

	/**
	 * Check if a folder exists.
	 */
	private async folderExists(path: string): Promise<boolean> {
		try {
			await access(path);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Check if a git branch exists.
	 */
	private async branchExists(branch: string): Promise<boolean> {
		const result = await execCommand(`git show-ref --verify --quiet refs/heads/${arg(branch)}`, {
			workingDirectory: this.config.repoPath,
		});
		return result.exitCode === 0;
	}

	/**
	 * Convert WorktreeState to Worktree.
	 */
	private stateToWorktree(state: WorktreeState): Worktree {
		return {
			id: state.id,
			path: state.path,
			branch: state.branch,
			optionId: state.optionId,
			createdAt: state.createdAt,
			active: state.active,
		};
	}

	/**
	 * Convert Worktree to WorktreeState.
	 */
	private worktreeToState(worktree: Worktree, featureId?: string): WorktreeState {
		return {
			id: worktree.id,
			path: worktree.path,
			branch: worktree.branch,
			optionId: worktree.optionId,
			featureId,
			createdAt: worktree.createdAt,
			active: worktree.active,
		};
	}

	/**
	 * Persist current worktree state.
	 */
	private async persistState(): Promise<void> {
		const states = Array.from(this.worktrees.values()).map((wt) => this.worktreeToState(wt));
		await this.persistence.save(states);
	}

	/**
	 * Checkout an existing branch into a new worktree (for recovery).
	 */
	private async checkoutExistingBranch(branch: string, optionId: string, featureId?: string): Promise<Worktree> {
		const worktreeId = `${this.config.worktreePrefix}-${optionId}-${Date.now()}`;
		const worktreePath = join(this.config.worktreeBaseDir, worktreeId);

		logger.info({ worktreeId, branch, path: worktreePath }, 'Checking out existing branch');

		// Ensure base directory exists
		await mkdir(this.config.worktreeBaseDir, { recursive: true });

		// Use existing branch (no -b flag)
		const result = await execCommand(`git worktree add ${arg(worktreePath)} ${arg(branch)}`, {
			workingDirectory: this.config.repoPath,
		});
		failOnError(`Failed to checkout existing branch ${branch}`, result);

		return {
			id: worktreeId,
			path: worktreePath,
			branch,
			optionId,
			createdAt: Date.now(),
			active: true,
		};
	}

	// ===========================================================================
	// Worktree Creation
	// ===========================================================================

	/**
	 * Creates a new worktree for an option
	 */
	async createWorktree(options: CreateWorktreeOptions): Promise<Worktree> {
		const { optionId, branch, base, featureId } = options;
		const worktreeId = `${this.config.worktreePrefix}-${optionId}-${Date.now()}`;
		const worktreePath = join(this.config.worktreeBaseDir, worktreeId);

		logger.info({ worktreeId, branch, base, path: worktreePath }, 'Creating worktree');

		// Ensure base directory exists
		await mkdir(this.config.worktreeBaseDir, { recursive: true });

		// Create the worktree with a new branch
		const baseRef = base ?? 'HEAD';
		const result = await execCommand(`git worktree add -b ${arg(branch)} ${arg(worktreePath)} ${arg(baseRef)}`, { workingDirectory: this.config.repoPath });
		failOnError(`Failed to create worktree for ${optionId}`, result);

		const worktree: Worktree = {
			id: worktreeId,
			path: worktreePath,
			branch,
			optionId,
			createdAt: Date.now(),
			active: true,
		};

		this.worktrees.set(worktreeId, worktree);

		// Persist state for recovery
		await this.persistence.upsertWorktree(this.worktreeToState(worktree, featureId));

		logger.info({ worktreeId, path: worktreePath }, 'Worktree created');

		return worktree;
	}

	/**
	 * Creates worktrees for multiple options
	 */
	async createWorktrees(options: CreateWorktreeOptions[]): Promise<Worktree[]> {
		const worktrees: Worktree[] = [];

		for (const opt of options) {
			const worktree = await this.createWorktree(opt);
			worktrees.push(worktree);
		}

		return worktrees;
	}

	// ===========================================================================
	// Worktree Removal
	// ===========================================================================

	/**
	 * Removes a worktree
	 */
	async removeWorktree(worktreeId: string, deleteBranch = false): Promise<void> {
		const worktree = this.worktrees.get(worktreeId);
		if (!worktree) {
			logger.warn({ worktreeId }, 'Worktree not found for removal');
			return;
		}

		logger.info({ worktreeId, path: worktree.path }, 'Removing worktree');

		// Remove the worktree
		const result = await execCommand(`git worktree remove ${arg(worktree.path)} --force`, { workingDirectory: this.config.repoPath });

		if (result.exitCode !== 0) {
			// Try manual cleanup if git worktree remove fails
			logger.warn({ worktreeId, error: result.stderr }, 'Git worktree remove failed, trying manual cleanup');
			try {
				await rm(worktree.path, { recursive: true, force: true });
				// Prune worktrees
				await execCommand('git worktree prune', { workingDirectory: this.config.repoPath });
			} catch (e) {
				logger.error(e, 'Manual worktree cleanup failed');
			}
		}

		// Optionally delete the branch
		if (deleteBranch) {
			const deleteResult = await execCommand(`git branch -D ${arg(worktree.branch)}`, { workingDirectory: this.config.repoPath });
			if (deleteResult.exitCode !== 0) {
				logger.warn({ branch: worktree.branch }, 'Failed to delete worktree branch');
			}
		}

		worktree.active = false;
		this.worktrees.delete(worktreeId);

		// Remove from persistence
		await this.persistence.removeWorktree(worktreeId);

		logger.info({ worktreeId }, 'Worktree removed');
	}

	/**
	 * Removes all worktrees and optionally their branches
	 */
	async cleanupAllWorktrees(deleteBranches = false): Promise<void> {
		const ids = Array.from(this.worktrees.keys());
		for (const id of ids) {
			await this.removeWorktree(id, deleteBranches);
		}

		// Clear persistence completely
		await this.persistence.clear();
	}

	// ===========================================================================
	// Worktree Queries
	// ===========================================================================

	/**
	 * Gets a worktree by ID
	 */
	getWorktree(worktreeId: string): Worktree | undefined {
		return this.worktrees.get(worktreeId);
	}

	/**
	 * Gets a worktree by option ID
	 */
	getWorktreeByOption(optionId: string): Worktree | undefined {
		for (const worktree of this.worktrees.values()) {
			if (worktree.optionId === optionId && worktree.active) {
				return worktree;
			}
		}
		return undefined;
	}

	/**
	 * Gets all active worktrees
	 */
	getActiveWorktrees(): Worktree[] {
		return Array.from(this.worktrees.values()).filter((wt) => wt.active);
	}

	/**
	 * Gets worktrees for a specific feature (from persistence).
	 */
	async getWorktreesForFeature(featureId: string): Promise<WorktreeState[]> {
		return this.persistence.getWorktreesForFeature(featureId);
	}

	/**
	 * Check if there's persisted state (for determining if recovery is possible).
	 */
	async hasPersistedState(): Promise<boolean> {
		return this.persistence.exists();
	}

	// ===========================================================================
	// Git Operations
	// ===========================================================================

	/**
	 * Lists all worktrees from git
	 */
	async listGitWorktrees(): Promise<GitWorktreeInfo[]> {
		const result = await execCommand('git worktree list --porcelain', { workingDirectory: this.config.repoPath });
		failOnError('Failed to list worktrees', result);

		return parseWorktreeList(result.stdout);
	}

	/**
	 * Prunes stale worktree references
	 */
	async pruneWorktrees(): Promise<void> {
		const result = await execCommand('git worktree prune', { workingDirectory: this.config.repoPath });
		failOnError('Failed to prune worktrees', result);
	}

	// ===========================================================================
	// Diff & Merge Operations
	// ===========================================================================

	/**
	 * Gets diff between worktree branch and base
	 */
	async getWorktreeDiff(worktreeId: string, base?: string): Promise<string> {
		const worktree = this.worktrees.get(worktreeId);
		if (!worktree) {
			throw new Error(`Worktree not found: ${worktreeId}`);
		}

		const baseRef = base ?? 'HEAD~1';
		const result = await execCommand(`git --no-pager diff ${arg(baseRef)}..HEAD`, { workingDirectory: worktree.path });
		failOnError('Failed to get worktree diff', result);

		return result.stdout;
	}

	/**
	 * Gets diff stats for a worktree
	 */
	async getWorktreeDiffStats(worktreeId: string, base?: string): Promise<WorktreeDiffStats> {
		const worktree = this.worktrees.get(worktreeId);
		if (!worktree) {
			throw new Error(`Worktree not found: ${worktreeId}`);
		}

		const baseRef = base ?? 'HEAD~1';
		const result = await execCommand(`git diff --shortstat ${arg(baseRef)}..HEAD`, { workingDirectory: worktree.path });
		failOnError('Failed to get worktree diff stats', result);

		return parseDiffStats(result.stdout);
	}

	/**
	 * Gets commit log for a worktree since base
	 */
	async getWorktreeCommitLog(worktreeId: string, base?: string): Promise<string> {
		const worktree = this.worktrees.get(worktreeId);
		if (!worktree) {
			throw new Error(`Worktree not found: ${worktreeId}`);
		}

		const baseRef = base ?? 'HEAD~1';
		const result = await execCommand(`git log --oneline ${arg(baseRef)}..HEAD`, { workingDirectory: worktree.path });
		failOnError('Failed to get worktree commit log', result);

		return result.stdout;
	}

	/**
	 * Merges a worktree's branch into a target branch
	 */
	async mergeWorktreeBranch(worktreeId: string, targetBranch: string, squash = true): Promise<string> {
		const worktree = this.worktrees.get(worktreeId);
		if (!worktree) {
			throw new Error(`Worktree not found: ${worktreeId}`);
		}

		logger.info({ worktreeId, branch: worktree.branch, target: targetBranch, squash }, 'Merging worktree branch');

		// Checkout target branch in main repo
		let result = await execCommand(`git checkout ${arg(targetBranch)}`, { workingDirectory: this.config.repoPath });
		failOnError(`Failed to checkout ${targetBranch}`, result);

		// Merge the worktree branch
		const mergeFlag = squash ? '--squash' : '--no-ff';
		result = await execCommand(`git merge ${mergeFlag} ${arg(worktree.branch)}`, { workingDirectory: this.config.repoPath });
		failOnError(`Failed to merge ${worktree.branch}`, result);

		// If squash merge, need to commit
		if (squash) {
			result = await execCommand(`git commit -m ${arg(`Merge parallel option: ${worktree.optionId}`)}`, { workingDirectory: this.config.repoPath });
			failOnError('Failed to commit squash merge', result);
		}

		// Get the merge commit
		result = await execCommand('git rev-parse HEAD', { workingDirectory: this.config.repoPath });
		failOnError('Failed to get merge commit', result);

		return result.stdout.trim();
	}
}

// ============================================================================
// Supporting Types and Utilities
// ============================================================================

/**
 * Info about a git worktree (from git worktree list)
 */
export interface GitWorktreeInfo {
	path: string;
	head: string;
	branch?: string;
	bare: boolean;
	detached: boolean;
}

/**
 * Diff statistics
 */
export interface WorktreeDiffStats {
	filesChanged: number;
	insertions: number;
	deletions: number;
}

/**
 * Parses git worktree list --porcelain output
 */
function parseWorktreeList(output: string): GitWorktreeInfo[] {
	const worktrees: GitWorktreeInfo[] = [];
	const lines = output.trim().split('\n');
	let current: Partial<GitWorktreeInfo> = {};

	for (const line of lines) {
		if (line === '') {
			if (current.path) {
				worktrees.push({
					path: current.path,
					head: current.head ?? '',
					branch: current.branch,
					bare: current.bare ?? false,
					detached: current.detached ?? false,
				});
			}
			current = {};
			continue;
		}

		if (line.startsWith('worktree ')) {
			current.path = line.slice(9);
		} else if (line.startsWith('HEAD ')) {
			current.head = line.slice(5);
		} else if (line.startsWith('branch ')) {
			current.branch = line.slice(7);
		} else if (line === 'bare') {
			current.bare = true;
		} else if (line === 'detached') {
			current.detached = true;
		}
	}

	// Don't forget the last one
	if (current.path) {
		worktrees.push({
			path: current.path,
			head: current.head ?? '',
			branch: current.branch,
			bare: current.bare ?? false,
			detached: current.detached ?? false,
		});
	}

	return worktrees;
}

/**
 * Parses git diff --shortstat output
 */
function parseDiffStats(output: string): WorktreeDiffStats {
	const trimmed = output.trim();
	if (!trimmed) {
		return { filesChanged: 0, insertions: 0, deletions: 0 };
	}

	const filesMatch = trimmed.match(/(\d+) files? changed/);
	const insertionsMatch = trimmed.match(/(\d+) insertions?\(\+\)/);
	const deletionsMatch = trimmed.match(/(\d+) deletions?\(-\)/);

	return {
		filesChanged: filesMatch ? Number.parseInt(filesMatch[1], 10) : 0,
		insertions: insertionsMatch ? Number.parseInt(insertionsMatch[1], 10) : 0,
		deletions: deletionsMatch ? Number.parseInt(deletionsMatch[1], 10) : 0,
	};
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a git worktree service
 */
export function createGitWorktreeService(config: GitWorktreeServiceConfig): GitWorktreeService {
	return new GitWorktreeService(config);
}
