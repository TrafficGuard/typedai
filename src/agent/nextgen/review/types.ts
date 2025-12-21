/**
 * Review Module Types
 *
 * Types for the AI review system with oscillation prevention.
 */

// =============================================================================
// Review Records
// =============================================================================

/**
 * A single review record for a feature attempt.
 */
export interface ReviewRecord {
	reviewId: string;
	timestamp: string; // ISO timestamp
	attempt: number; // Which implementation attempt this reviews
	decision: ReviewDecision;
	designDecisions: DesignDecision[];
	feedback: string;
	issues: ReviewIssue[];
	confidence: number; // 0.0 - 1.0
}

export type ReviewDecision = 'approved' | 'changes_requested' | 'escalate_to_human';

/**
 * An issue found during review.
 */
export interface ReviewIssue {
	id: string;
	severity: 'critical' | 'major' | 'minor' | 'suggestion';
	category: ReviewIssueCategory;
	description: string;
	file?: string;
	line?: number;
	suggestion?: string;
}

export type ReviewIssueCategory = 'security' | 'performance' | 'correctness' | 'style' | 'testing' | 'documentation' | 'architecture' | 'other';

// =============================================================================
// Design Decisions
// =============================================================================

/**
 * A design decision made during review.
 * These are BINDING for future reviews unless overridden by human.
 */
export interface DesignDecision {
	id: string;
	category: DesignDecisionCategory;
	decision: string;
	reasoning: string;
	alternatives_rejected: string[];
	madeAt: string; // ISO timestamp
	madeBy: 'review_agent' | 'human';
	featureId: string;
	reviewId: string;
}

export type DesignDecisionCategory = 'architecture' | 'pattern' | 'style' | 'testing' | 'naming' | 'api' | 'data' | 'security';

// =============================================================================
// Review History
// =============================================================================

/**
 * Complete review history for a feature.
 */
export interface FeatureReviewHistory {
	featureId: string;
	reviews: ReviewRecord[];
	bindingDecisions: DesignDecision[]; // Aggregated from all reviews
}

/**
 * Aggregated design decisions across all features in a task.
 */
export interface TaskDesignDecisions {
	taskId: string;
	decisions: DesignDecision[];
	byCategory: Record<DesignDecisionCategory, DesignDecision[]>;
	byFeature: Record<string, DesignDecision[]>;
}

// =============================================================================
// Review Context
// =============================================================================

/**
 * Context provided to the review agent.
 */
export interface ReviewContext {
	featureId: string;
	featureDescription: string;
	testCommand: string;
	attempt: number;

	// Diff information
	diffSummary: string;
	filesChanged: string[];
	linesAdded: number;
	linesRemoved: number;

	// Previous reviews
	previousReviews: ReviewRecord[];
	bindingDecisions: DesignDecision[];

	// Knowledge base
	learnings: string[];
	patterns: string[];
}

// =============================================================================
// Review Result
// =============================================================================

/**
 * Result of a review.
 */
export interface ReviewResult {
	decision: ReviewDecision;
	confidence: number;
	testsPassed: boolean;
	regressionDetected: boolean;

	// New design decisions from this review
	designDecisions: DesignDecision[];

	// Contradiction check
	contradictsPrevious: boolean;
	contradictionDetails?: string;

	issues: ReviewIssue[];
	suggestions: string[];
	reasoning: string;
}

// =============================================================================
// Contradiction Check
// =============================================================================

/**
 * Result of checking for contradictions with previous decisions.
 */
export interface ContradictionCheckResult {
	hasContradiction: boolean;
	contradictions: Contradiction[];
}

/**
 * A specific contradiction between new feedback and existing decision.
 */
export interface Contradiction {
	previousDecisionId: string;
	previousDecision: string;
	newSuggestion: string;
	severity: 'direct' | 'indirect' | 'potential';
	explanation: string;
}
