/**
 * Checkpoint Manager Service
 *
 * Manages checkpoint evaluation, state tracking, and user review flow.
 */

import { spawn } from 'node:child_process';
import { logger } from '#o11y/logger';
import type { ProgressSignal } from '#shared/agent/agent.model';
import type {
	CheckpointCondition,
	CheckpointConfig,
	CheckpointCriterion,
	CheckpointDecision,
	CheckpointDefinition,
	CheckpointProgressSummary,
	CheckpointReviewRequest,
	CheckpointReviewResponse,
	CheckpointState,
	CheckpointTrigger,
} from '#shared/evaluation/checkpoint.model';
import type { CheckpointResult, CriterionResult } from '#shared/evaluation/taskEvaluation.model';
import { getMetricsCollector } from '../metrics/metricsCollectorService';

/**
 * Context for checkpoint evaluation
 */
interface CheckpointContext {
	taskId: string;
	agentId: string;
	currentIteration: number;
	totalCost: number;
	startTime: number;
	consecutiveErrors: number;
	isStuck: boolean;
	agentState: string;
	lastError?: string;
	workingDirectory: string;
}

/**
 * Callback for checkpoint review
 */
export type CheckpointReviewCallback = (request: CheckpointReviewRequest) => Promise<CheckpointReviewResponse>;

/**
 * Manages checkpoint lifecycle and evaluation
 */
export class CheckpointManager {
	private config: CheckpointConfig;
	private states: Map<string, CheckpointState> = new Map();
	private context: CheckpointContext;
	private reviewCallback?: CheckpointReviewCallback;
	private completedMilestones: Set<string> = new Set();

	constructor(config: CheckpointConfig, context: Omit<CheckpointContext, 'currentIteration' | 'totalCost' | 'consecutiveErrors' | 'isStuck'>) {
		this.config = config;
		this.context = {
			...context,
			currentIteration: 0,
			totalCost: 0,
			consecutiveErrors: 0,
			isStuck: false,
		};

		// Initialize checkpoint states
		for (const checkpoint of config.checkpoints) {
			this.states.set(checkpoint.id, {
				definition: checkpoint,
				status: 'pending',
			});
		}
	}

	/**
	 * Sets the callback for user review
	 */
	setReviewCallback(callback: CheckpointReviewCallback): void {
		this.reviewCallback = callback;
	}

	/**
	 * Updates context with current execution state
	 */
	updateContext(updates: Partial<CheckpointContext>): void {
		Object.assign(this.context, updates);
	}

	/**
	 * Marks a milestone as completed
	 */
	completeMilestone(milestoneId: string): void {
		this.completedMilestones.add(milestoneId);
	}

	/**
	 * Checks if any checkpoint should be triggered
	 */
	async checkTriggers(): Promise<CheckpointDefinition | null> {
		// Check default triggers first
		for (const trigger of this.config.defaultTriggers) {
			if (this.shouldTrigger(trigger)) {
				// Find any pending checkpoint to attach this trigger to
				for (const [id, state] of this.states) {
					if (state.status === 'pending') {
						logger.info({ trigger, checkpointId: id }, 'Default trigger activated');
						return state.definition;
					}
				}
			}
		}

		// Check checkpoint-specific triggers
		for (const [id, state] of this.states) {
			if (state.status !== 'pending') continue;

			for (const condition of state.definition.conditions) {
				if (this.shouldTrigger(condition)) {
					logger.info({ condition, checkpointId: id }, 'Checkpoint trigger activated');
					return state.definition;
				}
			}
		}

		return null;
	}

	/**
	 * Evaluates whether a trigger condition is met
	 */
	private shouldTrigger(condition: CheckpointCondition): boolean {
		switch (condition.trigger) {
			case 'iteration_count':
				return condition.threshold !== undefined && this.context.currentIteration > 0 && this.context.currentIteration % condition.threshold === 0;

			case 'cost_threshold':
				return condition.threshold !== undefined && this.context.totalCost >= condition.threshold;

			case 'time_threshold': {
				const elapsedMinutes = (Date.now() - this.context.startTime) / 60000;
				return condition.threshold !== undefined && elapsedMinutes >= condition.threshold;
			}

			case 'milestone':
				return condition.milestoneId !== undefined && this.completedMilestones.has(condition.milestoneId);

			case 'stuck_detection':
				return this.context.isStuck;

			case 'error_threshold':
				return condition.threshold !== undefined && this.context.consecutiveErrors >= condition.threshold;

			case 'manual':
				return false; // Manual triggers are handled externally

			default:
				return false;
		}
	}

	/**
	 * Runs a checkpoint evaluation
	 */
	async evaluateCheckpoint(checkpoint: CheckpointDefinition): Promise<CheckpointResult> {
		const state = this.states.get(checkpoint.id);
		if (!state) throw new Error(`Unknown checkpoint: ${checkpoint.id}`);

		state.status = 'evaluating';
		state.triggeredAt = Date.now();

		const criteriaResults: CriterionResult[] = [];
		let allPassed = true;

		for (const criterion of checkpoint.criteria) {
			const result = await this.evaluateCriterion(criterion);
			criteriaResults.push(result);

			if (!result.passed && criterion.required) {
				allPassed = false;
			}
		}

		const checkpointResult: CheckpointResult = {
			checkpointId: checkpoint.id,
			checkpointName: checkpoint.name,
			status: allPassed ? 'passed' : 'failed',
			criteriaResults,
			iterationNumber: this.context.currentIteration,
			timestamp: Date.now(),
		};

		state.result = checkpointResult;
		state.status = allPassed ? 'passed' : 'failed';

		logger.info(
			{
				checkpointId: checkpoint.id,
				status: state.status,
				criteriaCount: criteriaResults.length,
				passedCount: criteriaResults.filter((r) => r.passed).length,
			},
			'Checkpoint evaluated',
		);

		return checkpointResult;
	}

	/**
	 * Evaluates a single criterion
	 */
	private async evaluateCriterion(criterion: CheckpointCriterion): Promise<CriterionResult> {
		const startTime = Date.now();

		if (criterion.type === 'manual') {
			// Manual criteria are always pending until user confirms
			return {
				type: 'manual',
				name: criterion.name,
				passed: false, // Will be updated by user review
				output: criterion.expected,
				durationMs: 0,
			};
		}

		if (!criterion.command) {
			return {
				type: criterion.type,
				name: criterion.name,
				passed: false,
				output: 'No command specified for criterion',
				durationMs: 0,
			};
		}

		try {
			const output = await this.runCommand(criterion.command, criterion.cwd);
			return {
				type: criterion.type,
				name: criterion.name,
				passed: true,
				output: output.substring(0, 5000), // Truncate large output
				durationMs: Date.now() - startTime,
			};
		} catch (e: any) {
			return {
				type: criterion.type,
				name: criterion.name,
				passed: false,
				output: e.message?.substring(0, 5000) || 'Command failed',
				durationMs: Date.now() - startTime,
			};
		}
	}

	/**
	 * Runs a shell command and returns output
	 */
	private runCommand(command: string, cwd?: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const workingDir = cwd || this.context.workingDirectory;
			const proc = spawn('sh', ['-c', command], {
				cwd: workingDir,
				env: process.env,
			});

			let stdout = '';
			let stderr = '';

			proc.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			proc.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			proc.on('close', (code) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
				}
			});

			proc.on('error', reject);

			// Timeout after 5 minutes
			setTimeout(() => {
				proc.kill();
				reject(new Error('Command timed out after 5 minutes'));
			}, 300000);
		});
	}

	/**
	 * Creates a review request for user
	 */
	createReviewRequest(checkpoint: CheckpointDefinition, result: CheckpointResult): CheckpointReviewRequest {
		const metricsCollector = getMetricsCollector();
		const progressSummary = metricsCollector.getTaskProgressSummary(this.context.taskId, this.context.agentId);

		return {
			taskId: this.context.taskId,
			agentId: this.context.agentId,
			checkpoint,
			result,
			progressSummary: {
				...progressSummary,
				filesCreated: 0, // TODO: track separately
				filesModified: 0, // Comes from iteration metrics
				agentState: this.context.agentState,
				lastError: this.context.lastError,
			},
			requestedAt: Date.now(),
		};
	}

	/**
	 * Handles checkpoint trigger - evaluates, requests review, returns decision
	 */
	async handleCheckpoint(checkpoint: CheckpointDefinition): Promise<CheckpointDecision> {
		// Evaluate the checkpoint
		const result = await this.evaluateCheckpoint(checkpoint);

		// If auto-continue is enabled and checkpoint passed, continue
		if (this.config.autoContinueOnPass && result.status === 'passed') {
			logger.info({ checkpointId: checkpoint.id }, 'Auto-continuing after passed checkpoint');
			return 'continue';
		}

		// Request user review
		if (!this.reviewCallback) {
			logger.warn('No review callback set, auto-continuing');
			return 'continue';
		}

		const request = this.createReviewRequest(checkpoint, result);

		try {
			const response = await Promise.race([
				this.reviewCallback(request),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Review timeout')), this.config.reviewTimeoutMs)),
			]);

			const state = this.states.get(checkpoint.id);
			if (state) {
				state.decision = response.decision;
				state.adjustmentInstructions = response.instructions;
			}

			logger.info({ checkpointId: checkpoint.id, decision: response.decision }, 'Checkpoint review completed');

			return response.decision;
		} catch (e) {
			logger.error(e, 'Checkpoint review failed or timed out');
			// Default to pause on timeout/error
			return 'pause';
		}
	}

	/**
	 * Gets adjustment instructions from the last checkpoint (if any)
	 */
	getAdjustmentInstructions(): string | undefined {
		for (const state of this.states.values()) {
			if (state.decision === 'adjust' && state.adjustmentInstructions) {
				return state.adjustmentInstructions;
			}
		}
		return undefined;
	}

	/**
	 * Gets all checkpoint results
	 */
	getAllResults(): CheckpointResult[] {
		const results: CheckpointResult[] = [];
		for (const state of this.states.values()) {
			if (state.result) {
				results.push(state.result);
			}
		}
		return results;
	}

	/**
	 * Gets summary of checkpoint progress
	 */
	getSummary(): { total: number; passed: number; failed: number; pending: number } {
		let passed = 0;
		let failed = 0;
		let pending = 0;

		for (const state of this.states.values()) {
			switch (state.status) {
				case 'passed':
					passed++;
					break;
				case 'failed':
					failed++;
					break;
				default:
					pending++;
			}
		}

		return { total: this.states.size, passed, failed, pending };
	}

	/**
	 * Serializes checkpoint state for persistence
	 */
	toJSON(): {
		config: CheckpointConfig;
		states: Array<{ id: string; state: CheckpointState }>;
		context: CheckpointContext;
		completedMilestones: string[];
	} {
		return {
			config: this.config,
			states: Array.from(this.states.entries()).map(([id, state]) => ({ id, state })),
			context: this.context,
			completedMilestones: Array.from(this.completedMilestones),
		};
	}

	/**
	 * Restores checkpoint state from persisted data
	 */
	static fromJSON(data: ReturnType<CheckpointManager['toJSON']>): CheckpointManager {
		const manager = new CheckpointManager(data.config, {
			taskId: data.context.taskId,
			agentId: data.context.agentId,
			startTime: data.context.startTime,
			agentState: data.context.agentState,
			lastError: data.context.lastError,
			workingDirectory: data.context.workingDirectory,
		});

		manager.context = data.context;
		manager.completedMilestones = new Set(data.completedMilestones);

		for (const { id, state } of data.states) {
			manager.states.set(id, state);
		}

		return manager;
	}
}

/**
 * Creates a default checkpoint configuration
 */
export function createDefaultCheckpointConfig(checkpoints: CheckpointDefinition[] = []): CheckpointConfig {
	return {
		checkpoints,
		defaultTriggers: [
			{
				trigger: 'iteration_count',
				threshold: 10,
				description: 'Review after every 10 iterations',
			},
			{
				trigger: 'cost_threshold',
				threshold: 1.0,
				description: 'Review after spending $1.00',
			},
			{
				trigger: 'stuck_detection',
				description: 'Review when agent appears stuck',
			},
		],
		autoContinueOnPass: false,
		reviewTimeoutMs: 600000, // 10 minutes
		persistState: true,
	};
}
