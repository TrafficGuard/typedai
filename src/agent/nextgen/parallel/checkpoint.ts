/**
 * Parallel Exploration Checkpoint
 *
 * Saves and restores parallel exploration state for recovery after process restart.
 * Stores checkpoint information in .typedai/parallel/{taskId}/{featureId}.json.
 *
 * Key features:
 * - Save exploration state at each phase
 * - Resume from any checkpoint phase
 * - Clean up checkpoints after completion
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TestResult } from '../memory/types';

// =============================================================================
// Types
// =============================================================================

export type ExplorationPhase = 'initializing' | 'implementing' | 'testing' | 'comparing' | 'finalizing' | 'complete';

export type ImplementationStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'timeout';

export interface ApproachCheckpoint {
	/** Approach ID */
	approachId: string;
	/** Description of the approach */
	description: string;
	/** Worktree ID where this approach is being explored */
	worktreeId: string;
	/** Git branch name */
	branch: string;
	/** Implementation status */
	status: ImplementationStatus;
	/** Accumulated cost for this approach */
	cost: number;
	/** Last activity timestamp */
	lastActivity: string;
	/** Test result if testing is complete */
	testResult?: TestResult;
	/** Files modified in this approach */
	filesModified?: string[];
	/** Error message if failed */
	error?: string;
}

export interface ParallelExplorationCheckpoint {
	/** Schema version for migrations */
	version: 1;
	/** Task ID */
	taskId: string;
	/** Feature being explored */
	featureId: string;
	/** Feature description */
	featureDescription: string;
	/** When the checkpoint was saved */
	savedAt: string;
	/** Current phase of exploration */
	phase: ExplorationPhase;
	/** Approach checkpoints */
	approaches: ApproachCheckpoint[];
	/** Selected approach ID (if comparison is complete) */
	selectedApproachId?: string;
	/** Selection reason */
	selectionReason?: string;
	/** Total exploration cost */
	totalCost: number;
	/** When exploration started */
	startedAt: string;
}

// =============================================================================
// ParallelExplorationCheckpointer Class
// =============================================================================

/**
 * Manages checkpoints for parallel exploration.
 */
export class ParallelExplorationCheckpointer {
	private baseDir: string;

	constructor(workingDir: string, taskId: string) {
		this.baseDir = path.join(workingDir, '.typedai', 'parallel', taskId);
	}

	// ===========================================================================
	// Persistence Operations
	// ===========================================================================

	/**
	 * Save a checkpoint.
	 */
	async save(checkpoint: ParallelExplorationCheckpoint): Promise<void> {
		const filePath = this.getCheckpointPath(checkpoint.featureId);
		await fs.mkdir(path.dirname(filePath), { recursive: true });

		const updated: ParallelExplorationCheckpoint = {
			...checkpoint,
			savedAt: new Date().toISOString(),
		};

		await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf-8');
	}

	/**
	 * Load a checkpoint for a feature.
	 */
	async load(featureId: string): Promise<ParallelExplorationCheckpoint | null> {
		const filePath = this.getCheckpointPath(featureId);
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			return JSON.parse(content) as ParallelExplorationCheckpoint;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Clear a checkpoint.
	 */
	async clear(featureId: string): Promise<void> {
		const filePath = this.getCheckpointPath(featureId);
		try {
			await fs.unlink(filePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
	}

	/**
	 * Check if a checkpoint exists.
	 */
	async exists(featureId: string): Promise<boolean> {
		const filePath = this.getCheckpointPath(featureId);
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * List all checkpoints in this task.
	 */
	async listCheckpoints(): Promise<string[]> {
		try {
			const files = await fs.readdir(this.baseDir);
			return files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}
			throw error;
		}
	}

	// ===========================================================================
	// Checkpoint Updates
	// ===========================================================================

	/**
	 * Update the phase of a checkpoint.
	 */
	async updatePhase(featureId: string, phase: ExplorationPhase): Promise<void> {
		const checkpoint = await this.load(featureId);
		if (checkpoint) {
			checkpoint.phase = phase;
			await this.save(checkpoint);
		}
	}

	/**
	 * Update an approach's status.
	 */
	async updateApproachStatus(featureId: string, approachId: string, status: ImplementationStatus, updates: Partial<ApproachCheckpoint> = {}): Promise<void> {
		const checkpoint = await this.load(featureId);
		if (!checkpoint) return;

		const approach = checkpoint.approaches.find((a) => a.approachId === approachId);
		if (approach) {
			approach.status = status;
			approach.lastActivity = new Date().toISOString();
			Object.assign(approach, updates);
			await this.save(checkpoint);
		}
	}

	/**
	 * Record test result for an approach.
	 */
	async recordTestResult(featureId: string, approachId: string, testResult: TestResult): Promise<void> {
		await this.updateApproachStatus(featureId, approachId, 'completed', {
			testResult,
		});
	}

	/**
	 * Record the selected approach.
	 */
	async recordSelection(featureId: string, selectedApproachId: string, reason: string): Promise<void> {
		const checkpoint = await this.load(featureId);
		if (checkpoint) {
			checkpoint.selectedApproachId = selectedApproachId;
			checkpoint.selectionReason = reason;
			checkpoint.phase = 'finalizing';
			await this.save(checkpoint);
		}
	}

	/**
	 * Add cost to checkpoint.
	 */
	async addCost(featureId: string, amount: number, approachId?: string): Promise<void> {
		const checkpoint = await this.load(featureId);
		if (!checkpoint) return;

		checkpoint.totalCost += amount;

		if (approachId) {
			const approach = checkpoint.approaches.find((a) => a.approachId === approachId);
			if (approach) {
				approach.cost += amount;
			}
		}

		await this.save(checkpoint);
	}

	// ===========================================================================
	// Checkpoint Creation
	// ===========================================================================

	/**
	 * Create a new checkpoint for starting exploration.
	 */
	createCheckpoint(
		taskId: string,
		featureId: string,
		featureDescription: string,
		approaches: Array<{
			approachId: string;
			description: string;
			worktreeId: string;
			branch: string;
		}>,
	): ParallelExplorationCheckpoint {
		const now = new Date().toISOString();

		return {
			version: 1,
			taskId,
			featureId,
			featureDescription,
			savedAt: now,
			phase: 'initializing',
			approaches: approaches.map((a) => ({
				approachId: a.approachId,
				description: a.description,
				worktreeId: a.worktreeId,
				branch: a.branch,
				status: 'pending',
				cost: 0,
				lastActivity: now,
			})),
			totalCost: 0,
			startedAt: now,
		};
	}

	// ===========================================================================
	// Resume Logic
	// ===========================================================================

	/**
	 * Determine what action to take when resuming from a checkpoint.
	 */
	async getResumeAction(featureId: string): Promise<ResumeAction | null> {
		const checkpoint = await this.load(featureId);
		if (!checkpoint) return null;

		switch (checkpoint.phase) {
			case 'initializing':
			case 'implementing': {
				// Find incomplete approaches
				const incompleteApproaches = checkpoint.approaches.filter((a) => a.status !== 'completed' && a.status !== 'failed');
				if (incompleteApproaches.length > 0) {
					return {
						action: 'continue_implementation',
						checkpoint,
						approachesToContinue: incompleteApproaches.map((a) => a.approachId),
					};
				}
				// All approaches have a result, move to testing
				return {
					action: 'run_tests',
					checkpoint,
				};
			}

			case 'testing': {
				// Find approaches that need testing
				const needsTesting = checkpoint.approaches.filter((a) => a.status === 'completed' && !a.testResult);
				if (needsTesting.length > 0) {
					return {
						action: 'run_tests',
						checkpoint,
						approachesToTest: needsTesting.map((a) => a.approachId),
					};
				}
				// All tested, move to comparison
				return {
					action: 'compare',
					checkpoint,
				};
			}

			case 'comparing':
				return {
					action: 'compare',
					checkpoint,
				};

			case 'finalizing':
				return {
					action: 'finalize',
					checkpoint,
				};

			case 'complete':
				return {
					action: 'already_complete',
					checkpoint,
				};
		}
	}

	// ===========================================================================
	// Helpers
	// ===========================================================================

	private getCheckpointPath(featureId: string): string {
		return path.join(this.baseDir, `${featureId}.json`);
	}
}

// =============================================================================
// Types
// =============================================================================

export type ResumeActionType = 'continue_implementation' | 'run_tests' | 'compare' | 'finalize' | 'already_complete';

export interface ResumeAction {
	action: ResumeActionType;
	checkpoint: ParallelExplorationCheckpoint;
	approachesToContinue?: string[];
	approachesToTest?: string[];
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a parallel exploration checkpointer.
 */
export function createParallelCheckpointer(workingDir: string, taskId: string): ParallelExplorationCheckpointer {
	return new ParallelExplorationCheckpointer(workingDir, taskId);
}
