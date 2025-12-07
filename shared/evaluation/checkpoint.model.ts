/**
 * Checkpoint System Models
 *
 * Types for milestone-based progress tracking and human-in-the-loop review.
 */

import type { CheckpointResult, CriterionResult, TaskStatus } from './taskEvaluation.model';

/**
 * Checkpoint trigger types
 */
export type CheckpointTrigger =
	| 'iteration_count' // After N iterations
	| 'cost_threshold' // After spending $X
	| 'time_threshold' // After X minutes
	| 'milestone' // After completing a defined milestone
	| 'stuck_detection' // When loop detection triggers
	| 'error_threshold' // After N consecutive errors
	| 'manual'; // User-requested checkpoint

/**
 * Checkpoint review decision by user
 */
export type CheckpointDecision =
	| 'continue' // Continue execution as planned
	| 'adjust' // Continue with adjustments (new instructions)
	| 'pause' // Pause and save state for later
	| 'abort'; // Stop execution entirely

/**
 * Definition of a checkpoint condition
 */
export interface CheckpointCondition {
	/** Type of trigger */
	trigger: CheckpointTrigger;
	/** Value threshold (iterations, cost, minutes, etc.) */
	threshold?: number;
	/** Milestone identifier (for milestone triggers) */
	milestoneId?: string;
	/** Human-readable description */
	description: string;
}

/**
 * Checkpoint definition for a task
 */
export interface CheckpointDefinition {
	/** Unique checkpoint identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** Description of what this checkpoint validates */
	description: string;
	/** Conditions that trigger this checkpoint */
	conditions: CheckpointCondition[];
	/** Criteria to evaluate at this checkpoint */
	criteria: CheckpointCriterion[];
	/** Whether this checkpoint is required to pass */
	required: boolean;
	/** Order in which checkpoints are evaluated */
	order: number;
}

/**
 * Criterion to evaluate at a checkpoint
 */
export interface CheckpointCriterion {
	/** Type of criterion */
	type: CriterionResult['type'];
	/** Human-readable name */
	name: string;
	/** Command to run (for build/test/typecheck/lint) */
	command?: string;
	/** Working directory for the command */
	cwd?: string;
	/** Expected outcome description (for manual criteria) */
	expected?: string;
	/** Whether failure of this criterion fails the checkpoint */
	required: boolean;
}

/**
 * State of a checkpoint during execution
 */
export interface CheckpointState {
	/** Checkpoint definition */
	definition: CheckpointDefinition;
	/** Current status */
	status: 'pending' | 'triggered' | 'evaluating' | 'passed' | 'failed' | 'skipped';
	/** When the checkpoint was triggered */
	triggeredAt?: number;
	/** Results of criteria evaluation */
	result?: CheckpointResult;
	/** User's decision after review */
	decision?: CheckpointDecision;
	/** Additional instructions from user (if decision was 'adjust') */
	adjustmentInstructions?: string;
}

/**
 * Checkpoint review request shown to user
 */
export interface CheckpointReviewRequest {
	/** Task identifier */
	taskId: string;
	/** Agent identifier */
	agentId: string;
	/** Checkpoint being reviewed */
	checkpoint: CheckpointDefinition;
	/** Current checkpoint result */
	result: CheckpointResult;
	/** Summary of progress so far */
	progressSummary: CheckpointProgressSummary;
	/** Timestamp of review request */
	requestedAt: number;
}

/**
 * Summary of progress at a checkpoint
 */
export interface CheckpointProgressSummary {
	/** Total iterations completed */
	iterationsCompleted: number;
	/** Cost incurred so far */
	costSoFar: number;
	/** Time elapsed in milliseconds */
	timeElapsedMs: number;
	/** Whether agent appears stuck */
	isStuck: boolean;
	/** Recent progress signals */
	recentProgress: string[];
	/** Checkpoints passed so far */
	checkpointsPassed: number;
	/** Checkpoints failed so far */
	checkpointsFailed: number;
	/** Files created */
	filesCreated: number;
	/** Files modified */
	filesModified: number;
	/** Current agent state */
	agentState: string;
	/** Last error (if any) */
	lastError?: string;
}

/**
 * User's response to a checkpoint review
 */
export interface CheckpointReviewResponse {
	/** The decision made */
	decision: CheckpointDecision;
	/** Additional instructions (for 'adjust' decision) */
	instructions?: string;
	/** Notes for the checkpoint record */
	notes?: string;
	/** Timestamp of response */
	respondedAt: number;
}

/**
 * Configuration for checkpoint-based execution
 */
export interface CheckpointConfig {
	/** All checkpoint definitions for this task */
	checkpoints: CheckpointDefinition[];
	/** Default triggers applied to all tasks */
	defaultTriggers: CheckpointCondition[];
	/** Whether to auto-continue on passed checkpoints */
	autoContinueOnPass: boolean;
	/** Timeout for waiting for user review (ms) */
	reviewTimeoutMs: number;
	/** Whether to persist checkpoint state for resume */
	persistState: boolean;
}

/**
 * Default checkpoint triggers for autonomous operation
 */
export const DEFAULT_CHECKPOINT_TRIGGERS: CheckpointCondition[] = [
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
		description: 'Review when agent appears stuck in a loop',
	},
	{
		trigger: 'error_threshold',
		threshold: 3,
		description: 'Review after 3 consecutive errors',
	},
];

/**
 * Creates a basic checkpoint for a milestone
 */
export function createMilestoneCheckpoint(
	id: string,
	name: string,
	description: string,
	criteria: CheckpointCriterion[],
	order: number,
): CheckpointDefinition {
	return {
		id,
		name,
		description,
		conditions: [
			{
				trigger: 'milestone',
				milestoneId: id,
				description: `Checkpoint: ${name}`,
			},
		],
		criteria,
		required: true,
		order,
	};
}

/**
 * Common checkpoint criteria for TypeScript projects
 */
export const TYPESCRIPT_CHECKPOINT_CRITERIA: CheckpointCriterion[] = [
	{
		type: 'typecheck',
		name: 'TypeScript Compilation',
		command: 'npm run build',
		required: true,
	},
	{
		type: 'lint',
		name: 'Lint Check',
		command: 'npm run lint',
		required: false,
	},
	{
		type: 'test',
		name: 'Unit Tests',
		command: 'npm run test',
		required: true,
	},
];
