/**
 * Subtask Model
 *
 * Types and interfaces for hierarchical sub-task management with git branching.
 * Sub-tasks allow large work to be decomposed into reviewable units, each on
 * its own git branch with human review checkpoints.
 */

// ============================================================================
// Core Subtask Types
// ============================================================================

/**
 * Status of a subtask
 */
export type SubtaskStatus = 'active' | 'review' | 'approved' | 'aborted';

/**
 * Decision from a human review
 */
export type ReviewDecision = 'approved' | 'changes_requested' | 'aborted';

/**
 * A single review round for a subtask
 */
export interface ReviewRound {
	/** When the review was requested */
	requestedAt: number;
	/** Summary provided by agent of work done */
	summary: string;
	/** Human's decision (populated after review) */
	decision?: ReviewDecision;
	/** Feedback from human reviewer */
	feedback?: string;
	/** When the review was completed */
	respondedAt?: number;
	/** Git commit at time of review request */
	commitAtRequest?: string;
}

/**
 * A subtask with git branching and review tracking
 */
export interface Subtask {
	/** Unique identifier for this subtask */
	id: string;
	/** Human-readable description */
	description: string;
	/** Git branch name for this subtask */
	branch: string;
	/** Base commit this branch was created from */
	baseCommit: string;
	/** Parent subtask ID (if nested) */
	parentId?: string;
	/** Child subtask IDs */
	childIds: string[];
	/** Current status */
	status: SubtaskStatus;
	/** When the subtask was started */
	startedAt: number;
	/** When the subtask was completed (approved/aborted) */
	completedAt?: number;
	/** Final commit after squash merge (if approved) */
	finalCommit?: string;
	/** Review rounds for this subtask */
	reviewRounds: ReviewRound[];
}

/**
 * Subtask state stored in agent toolState
 */
export interface SubtaskToolState {
	/** Map of all subtasks by ID */
	subtasks: Record<string, Subtask>;
	/** Stack tracking current context (allows nested work) */
	subtaskStack: string[];
	/** Base branch to return to when all subtasks complete */
	baseBranch: string;
}

// ============================================================================
// Review Request/Response Types
// ============================================================================

/**
 * Summary of subtask progress for review
 */
export interface SubtaskProgressSummary {
	/** Subtask being reviewed */
	subtask: Subtask;
	/** Parent subtask chain (if nested) */
	parentChain: Array<{ id: string; description: string }>;
	/** Child subtasks and their status */
	children: Array<{ id: string; description: string; status: SubtaskStatus }>;
	/** Git diff stats */
	diffStats: {
		filesChanged: number;
		linesAdded: number;
		linesRemoved: number;
	};
	/** Number of commits on branch */
	commitCount: number;
	/** Total iterations spent on this subtask */
	iterations: number;
	/** Cost incurred on this subtask */
	cost: number;
}

/**
 * Request for human review of a subtask
 */
export interface SubtaskReviewRequest {
	/** Task ID */
	taskId: string;
	/** Agent ID */
	agentId: string;
	/** Progress summary */
	progressSummary: SubtaskProgressSummary;
	/** Agent's summary of work done */
	workSummary: string;
	/** When the review was requested */
	requestedAt: number;
	/** Review round number (1-based) */
	reviewRound: number;
}

/**
 * Human response to a subtask review request
 */
export interface SubtaskReviewResponse {
	/** Decision made */
	decision: ReviewDecision;
	/** Feedback/instructions for the agent */
	feedback?: string;
	/** When the response was made */
	respondedAt: number;
}

// ============================================================================
// Subtask Evaluation Types
// ============================================================================

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
	finalCommit: string;
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
	outcome: 'approved' | 'aborted';
	/** When completed */
	completedAt: number;
}

// ============================================================================
// Status Helpers
// ============================================================================

/**
 * Summary of a subtask for display
 */
export interface SubtaskSummary {
	id: string;
	description: string;
	status: SubtaskStatus;
	branch: string;
	parentId?: string;
	childCount: number;
	reviewRounds: number;
	depth: number;
}

/**
 * Full status of current subtask context
 */
export interface SubtaskContextStatus {
	/** Current subtask (top of stack) */
	current?: Subtask;
	/** Parent chain from current to root */
	parentChain: Subtask[];
	/** All subtasks in the task */
	allSubtasks: SubtaskSummary[];
	/** Base branch */
	baseBranch: string;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for subtask behavior
 */
export interface SubtaskConfig {
	/** Maximum review rounds before warning */
	maxReviewRounds: number;
	/** Whether to auto-commit uncommitted changes before review */
	autoCommitOnReview: boolean;
	/** Whether to squash merge on approval */
	squashMergeOnApproval: boolean;
	/** Branch prefix for subtask branches */
	branchPrefix: string;
}

/**
 * Default subtask configuration
 */
export const DEFAULT_SUBTASK_CONFIG: SubtaskConfig = {
	maxReviewRounds: 5,
	autoCommitOnReview: true,
	squashMergeOnApproval: true,
	branchPrefix: 'subtask',
};

// ============================================================================
// Type Guards
// ============================================================================

export function isSubtaskStatus(value: string): value is SubtaskStatus {
	return ['active', 'review', 'approved', 'aborted'].includes(value);
}

export function isReviewDecision(value: string): value is ReviewDecision {
	return ['approved', 'changes_requested', 'aborted'].includes(value);
}

/**
 * Gets the current subtask from tool state
 */
export function getCurrentSubtask(toolState: SubtaskToolState): Subtask | undefined {
	if (toolState.subtaskStack.length === 0) return undefined;
	const currentId = toolState.subtaskStack[toolState.subtaskStack.length - 1];
	return toolState.subtasks[currentId];
}

/**
 * Gets the parent chain for a subtask
 */
export function getParentChain(subtask: Subtask, toolState: SubtaskToolState): Subtask[] {
	const chain: Subtask[] = [];
	let current = subtask;

	while (current.parentId) {
		const parent = toolState.subtasks[current.parentId];
		if (!parent) break;
		chain.push(parent);
		current = parent;
	}

	return chain;
}

/**
 * Gets the depth of a subtask in the hierarchy
 */
export function getSubtaskDepth(subtask: Subtask, toolState: SubtaskToolState): number {
	return getParentChain(subtask, toolState).length;
}

/**
 * Creates an empty subtask tool state
 */
export function createEmptySubtaskToolState(baseBranch: string): SubtaskToolState {
	return {
		subtasks: {},
		subtaskStack: [],
		baseBranch,
	};
}
