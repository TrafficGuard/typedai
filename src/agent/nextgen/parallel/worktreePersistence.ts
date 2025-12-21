/**
 * Worktree Persistence
 *
 * Persists worktree state to disk for recovery after process restart.
 * Stores checkpoint information in .typedai/worktrees/{taskId}/checkpoint.json.
 *
 * Key features:
 * - Save/load worktree state
 * - Track active worktrees with their git branches
 * - Enable recovery of parallel exploration state
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// =============================================================================
// Types
// =============================================================================

export interface WorktreeState {
	/** Unique worktree ID */
	id: string;
	/** Path to the worktree directory */
	path: string;
	/** Git branch name */
	branch: string;
	/** Option/approach ID this worktree is exploring */
	optionId: string;
	/** Feature ID if applicable */
	featureId?: string;
	/** When the worktree was created (timestamp) */
	createdAt: number;
	/** Whether the worktree is currently active */
	active: boolean;
	/** Last commit SHA if any */
	lastCommit?: string;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

export interface WorktreeCheckpoint {
	/** Schema version for migrations */
	version: 1;
	/** Task ID this checkpoint belongs to */
	taskId: string;
	/** When the checkpoint was saved */
	savedAt: string;
	/** All worktree states */
	worktrees: WorktreeState[];
}

// =============================================================================
// WorktreePersistence Class
// =============================================================================

/**
 * Manages persistence of worktree state.
 */
export class WorktreePersistence {
	private checkpointPath: string;

	constructor(workingDir: string, taskId: string) {
		this.checkpointPath = path.join(workingDir, '.typedai', 'worktrees', taskId, 'checkpoint.json');
	}

	// ===========================================================================
	// Persistence Operations
	// ===========================================================================

	/**
	 * Save worktree states to checkpoint file.
	 */
	async save(worktrees: WorktreeState[]): Promise<void> {
		const checkpoint: WorktreeCheckpoint = {
			version: 1,
			taskId: this.extractTaskId(),
			savedAt: new Date().toISOString(),
			worktrees,
		};

		await fs.mkdir(path.dirname(this.checkpointPath), { recursive: true });
		await fs.writeFile(this.checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
	}

	/**
	 * Load worktree checkpoint from file.
	 */
	async load(): Promise<WorktreeCheckpoint | null> {
		try {
			const content = await fs.readFile(this.checkpointPath, 'utf-8');
			return JSON.parse(content) as WorktreeCheckpoint;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Clear the checkpoint file.
	 */
	async clear(): Promise<void> {
		try {
			await fs.unlink(this.checkpointPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	/**
	 * Check if a checkpoint exists.
	 */
	async exists(): Promise<boolean> {
		try {
			await fs.access(this.checkpointPath);
			return true;
		} catch {
			return false;
		}
	}

	// ===========================================================================
	// State Operations
	// ===========================================================================

	/**
	 * Add or update a worktree state.
	 */
	async upsertWorktree(state: WorktreeState): Promise<void> {
		const checkpoint = await this.load();
		const worktrees = checkpoint?.worktrees || [];

		const index = worktrees.findIndex((w) => w.id === state.id);
		if (index >= 0) {
			worktrees[index] = state;
		} else {
			worktrees.push(state);
		}

		await this.save(worktrees);
	}

	/**
	 * Remove a worktree state by ID.
	 */
	async removeWorktree(worktreeId: string): Promise<void> {
		const checkpoint = await this.load();
		if (!checkpoint) return;

		const worktrees = checkpoint.worktrees.filter((w) => w.id !== worktreeId);
		await this.save(worktrees);
	}

	/**
	 * Mark a worktree as inactive.
	 */
	async deactivateWorktree(worktreeId: string): Promise<void> {
		const checkpoint = await this.load();
		if (!checkpoint) return;

		const worktrees = checkpoint.worktrees.map((w) => (w.id === worktreeId ? { ...w, active: false } : w));
		await this.save(worktrees);
	}

	/**
	 * Get all active worktrees.
	 */
	async getActiveWorktrees(): Promise<WorktreeState[]> {
		const checkpoint = await this.load();
		if (!checkpoint) return [];

		return checkpoint.worktrees.filter((w) => w.active);
	}

	/**
	 * Get worktrees for a specific feature.
	 */
	async getWorktreesForFeature(featureId: string): Promise<WorktreeState[]> {
		const checkpoint = await this.load();
		if (!checkpoint) return [];

		return checkpoint.worktrees.filter((w) => w.featureId === featureId);
	}

	// ===========================================================================
	// Helpers
	// ===========================================================================

	private extractTaskId(): string {
		// Extract task ID from checkpoint path
		const parts = this.checkpointPath.split(path.sep);
		const worktreesIndex = parts.indexOf('worktrees');
		return worktreesIndex >= 0 ? parts[worktreesIndex + 1] : 'unknown';
	}
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a worktree persistence instance.
 */
export function createWorktreePersistence(workingDir: string, taskId: string): WorktreePersistence {
	return new WorktreePersistence(workingDir, taskId);
}
