/**
 * Subtask Module
 *
 * Exports for hierarchical subtask management with git branching and human review.
 */

// Models and types
export * from './subtask.model';

// Git branching utilities
export {
	GitBranchingService,
	createSubtaskBranchName,
	extractSubtaskId,
	completeSubtask,
	abortSubtask,
	type GitOptions,
	type DiffStats,
} from './gitBranching';

// Subtask manager (agent functions)
export {
	SubtaskManager,
	HITL_REVIEW_STATE,
	handleReviewDecision,
	getReviewInfo,
} from './subtaskManager';
