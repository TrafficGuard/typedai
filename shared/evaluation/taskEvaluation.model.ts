/**
 * Task Evaluation Models
 *
 * Types for evaluating end-to-end agent task completion.
 */

import type { DecisionType, ProgressSignal } from '../agent/agent.model';

/**
 * Status of a task evaluation
 */
export type TaskStatus = 'running' | 'completed' | 'partial' | 'failed' | 'timeout' | 'cancelled';

/**
 * Result of a checkpoint evaluation
 */
export interface CheckpointResult {
	checkpointId: string;
	checkpointName: string;
	status: 'passed' | 'failed' | 'skipped';
	criteriaResults: CriterionResult[];
	iterationNumber: number;
	timestamp: number;
	details?: string;
}

/**
 * Result of evaluating a single criterion
 */
export interface CriterionResult {
	type: 'build' | 'test' | 'typecheck' | 'lint' | 'manual' | 'custom';
	name: string;
	passed: boolean;
	output?: string;
	durationMs?: number;
}

/**
 * Post-hoc analysis of task completion
 */
export interface TaskPostHocAnalysis {
	/** Overall quality score (0-100) */
	overallScore: number;
	/** Dimension-specific scores */
	dimensions: {
		codeQuality: number;
		testCoverage: number;
		efficiency: number;
		adherenceToSpec: number;
	};
	/** Areas where the agent performed well */
	strengthAreas: string[];
	/** Areas for improvement */
	weaknessAreas: string[];
	/** Recommendations for future runs */
	recommendations: string[];
	/** LLM-generated judgments */
	llmJudgments?: Array<{
		criterion: string;
		score: number;
		reasoning: string;
	}>;
}

/**
 * Summary of iteration patterns during task execution
 */
export interface IterationPatternSummary {
	/** Distribution of progress signals */
	progressSignalDistribution: Record<ProgressSignal, number>;
	/** Distribution of decision types */
	decisionTypeDistribution: Record<DecisionType, number>;
	/** Number of times agent appeared stuck */
	stuckEpisodes: number;
	/** Longest sequence of stuck iterations */
	longestStuckSequence: number;
	/** Number of error recovery attempts */
	errorRecoveryAttempts: number;
	/** Successful error recoveries */
	successfulRecoveries: number;
}

/**
 * Complete evaluation of an agent task
 */
export interface TaskEvaluation {
	/** Unique task identifier */
	taskId: string;
	/** Agent that executed the task */
	agentId: string;
	/** User who initiated the task */
	userId?: string;
	/** Human-readable task description */
	taskDescription: string;

	// === Outcome ===
	/** Final status */
	status: TaskStatus;
	/** Quality of completion (if completed) */
	completionQuality?: 'full' | 'partial' | 'minimal';
	/** Final output/result text */
	output?: string;
	/** Error message if failed */
	error?: string;

	// === Efficiency Metrics ===
	/** Total iterations executed */
	totalIterations: number;
	/** Total wall-clock time (ms) */
	totalDurationMs: number;
	/** Total cost in USD */
	totalCostUsd: number;

	// === Token Economics ===
	/** Total input tokens across all LLM calls */
	totalInputTokens: number;
	/** Total output tokens */
	totalOutputTokens: number;
	/** Total cached input tokens */
	totalCachedTokens: number;
	/** Overall cache hit ratio */
	overallCacheHitRatio: number;
	/** Total reasoning/thinking tokens */
	totalReasoningTokens: number;

	// === Agent Behavior ===
	/** Number of context compactions performed */
	compactionCount: number;
	/** Number of times agent was detected as stuck */
	stuckCount: number;
	/** Number of human-in-the-loop interventions */
	humanInterventions: number;
	/** Total errors encountered */
	errorCount: number;
	/** Rate of successful error recovery (0-1) */
	errorRecoveryRate: number;

	// === Progress Tracking ===
	/** Results of checkpoint evaluations */
	checkpointResults: CheckpointResult[];
	/** Patterns observed in iterations */
	iterationPatterns?: IterationPatternSummary;

	// === Learnings ===
	/** Number of learnings extracted */
	learningsCount: number;
	/** Learnings by type */
	learningsByType?: Record<string, number>;

	// === File Changes ===
	/** Total files created */
	filesCreated: number;
	/** Total files modified */
	filesModified: number;
	/** Total files deleted */
	filesDeleted: number;
	/** Net lines changed (added - removed) */
	netLinesChanged: number;

	// === Timestamps ===
	/** When task started */
	startedAt: number;
	/** When task completed (if finished) */
	completedAt?: number;

	// === Analysis ===
	/** Post-hoc quality analysis (if performed) */
	postHocAnalysis?: TaskPostHocAnalysis;
}

/**
 * Summary view of task evaluation for listings
 */
export interface TaskEvaluationSummary {
	taskId: string;
	agentId: string;
	taskDescription: string;
	status: TaskStatus;
	totalIterations: number;
	totalCostUsd: number;
	totalDurationMs: number;
	checkpointsPassed: number;
	checkpointsFailed: number;
	startedAt: number;
	completedAt?: number;
}

/**
 * Configuration for task evaluation
 */
export interface TaskEvaluationConfig {
	/** Whether to run post-hoc analysis */
	runPostHocAnalysis: boolean;
	/** Checkpoints to evaluate */
	checkpoints?: string[];
	/** Budget limit for the task */
	budgetLimit?: number;
	/** Iteration limit for the task */
	iterationLimit?: number;
	/** Time limit in ms */
	timeLimit?: number;
}

// ============================================================================
// Subtask Evaluation Types
// ============================================================================

/**
 * Outcome of a subtask
 */
export type SubtaskOutcome = 'approved' | 'aborted';

/**
 * Evaluation metrics for a completed subtask
 */
export interface SubtaskEvaluation {
	/** Subtask ID */
	subtaskId: string;
	/** Agent ID that worked on this subtask */
	agentId: string;
	/** Task ID this subtask belongs to */
	taskId: string;
	/** Description of the subtask */
	description: string;
	/** Git branch used */
	branch: string;
	/** Base commit */
	baseCommit: string;
	/** Final commit after squash merge */
	finalCommit?: string;
	/** Parent subtask ID (if nested) */
	parentSubtaskId?: string;
	/** Child subtask IDs */
	childSubtaskIds: string[];
	/** Number of review rounds */
	reviewRounds: number;
	/** Total iterations used */
	totalIterations: number;
	/** Total cost incurred */
	totalCost: number;
	/** Duration in milliseconds */
	durationMs: number;
	/** Files changed */
	filesChanged: number;
	/** Lines added */
	linesAdded: number;
	/** Lines removed */
	linesRemoved: number;
	/** Outcome */
	outcome: SubtaskOutcome;
	/** When started */
	startedAt: number;
	/** When completed */
	completedAt: number;
}

/**
 * Summary of subtask hierarchy and progress
 */
export interface SubtaskHierarchySummary {
	/** Total number of subtasks */
	totalSubtasks: number;
	/** Subtasks completed (approved) */
	subtasksCompleted: number;
	/** Subtasks aborted */
	subtasksAborted: number;
	/** Maximum nesting depth */
	maxDepth: number;
	/** Total review rounds across all subtasks */
	totalReviewRounds: number;
	/** Average review rounds per subtask */
	avgReviewRoundsPerSubtask: number;
}

/**
 * Extended TaskEvaluation with subtask support
 */
export interface TaskEvaluationWithSubtasks extends TaskEvaluation {
	/** All subtask evaluations */
	subtaskEvaluations: SubtaskEvaluation[];
	/** Summary of subtask hierarchy */
	subtaskSummary: SubtaskHierarchySummary;
}
