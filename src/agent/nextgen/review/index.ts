/**
 * AI Review Module
 *
 * Provides AI-powered code review with oscillation prevention.
 * The review agent is SEPARATE from the implementing agent.
 */

// Legacy v1 exports (for backward compatibility)
export {
	AIReviewer,
	createAIReviewer,
	type AIReviewerConfig,
	type BranchReviewInput,
	type ReviewResult as AIReviewResult,
	type ReviewIssue as AIReviewIssue,
	type IssueSeverity,
} from './aiReviewer';

// v2 Types
export type {
	Contradiction,
	ContradictionCheckResult,
	DesignDecision,
	DesignDecisionCategory,
	FeatureReviewHistory,
	ReviewContext,
	ReviewDecision,
	ReviewIssue,
	ReviewIssueCategory,
	ReviewRecord,
	ReviewResult,
	TaskDesignDecisions,
} from './types';

// v2 Review History
export {
	addReviewRecord,
	aggregateDesignDecisions,
	formatReviewHistoryForContext,
	generateDecisionId,
	generateReviewId,
	getBindingDecisions,
	getDecisionsByCategory,
	getDecisionsByFeature,
	getLatestReview,
	loadReviewHistory,
	loadTaskDesignDecisions,
	saveReviewHistory,
	saveTaskDesignDecisions,
} from './reviewHistory';

// v2 Contradiction Checker
export {
	checkForContradictions,
	formatContradictionForReview,
	resolveContradiction,
	type ContradictionResolution,
} from './contradictionChecker';

// v2 Review Agent
export {
	runReviewAgent,
	type ReviewAgentConfig,
	type ReviewAgentInput,
} from './reviewAgent';
