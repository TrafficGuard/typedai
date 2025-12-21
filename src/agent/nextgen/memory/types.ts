/**
 * Domain Memory Types
 *
 * This module defines the core types for the domain memory system that provides
 * cross-session persistence for long-running autonomous coding agents.
 *
 * Key files in .typedai/memory/{taskId}/:
 * - goals.yaml: What we want to achieve (stable, human-editable)
 * - status.json: What's verified true (machine-updated by tests)
 * - progress.md: What happened (append-only audit log)
 * - context.md: What agent needs now (regenerated each session)
 */

// =============================================================================
// Feature Level (Atomic Unit of Work)
// =============================================================================

/**
 * Feature is the atomic unit of work with a test binding.
 * Each feature has exactly one testCommand that verifies completion.
 */
export interface Feature {
	id: string;
	description: string;
	testCommand: string;
	dependsOn: string[];
	estimatedComplexity: 'low' | 'medium' | 'high';
}

/**
 * FeatureStatus tracks the test-verified state of a feature.
 * Status can ONLY be changed by:
 * 1. testRunner.ts running the testCommand
 * 2. reviewAgent.ts approving/rejecting after tests pass
 */
export interface FeatureStatus {
	status: FeatureStatusValue;
	lastTest?: string; // ISO timestamp
	lastTestDuration?: number; // milliseconds
	attempts: number;
	maxAttempts: number; // default: 3
	lastError?: string;
	commits: string[];
}

export type FeatureStatusValue = 'pending' | 'in_progress' | 'passing' | 'failing' | 'blocked';

// =============================================================================
// Hierarchy: Task -> Milestone -> Subtask -> Feature
// =============================================================================

/**
 * Subtask is a logical grouping of related features.
 */
export interface SubtaskGoal {
	id: string;
	name: string;
	description: string;
	features: Feature[];
}

/**
 * Milestone is a reviewable checkpoint that represents meaningful progress.
 */
export interface MilestoneGoal {
	id: string;
	name: string;
	description: string;
	requiresHumanReview: boolean;
	dependsOn: string[];
	completionCriteria: string[];
	subtasks: SubtaskGoal[];
}

/**
 * MilestoneStatus tracks aggregate progress across all features in a milestone.
 */
export interface MilestoneStatus {
	status: 'pending' | 'in_progress' | 'passing' | 'blocked';
	passing: number;
	total: number;
}

/**
 * GoalTree represents the complete hierarchical goals for a task.
 * Stored in goals.yaml (human-editable, stable).
 */
export interface GoalTree {
	task: string;
	description: string;
	createdAt: string; // ISO timestamp
	updatedAt?: string; // ISO timestamp
	milestones: MilestoneGoal[];
	constraints?: string[];
	preferences?: string[];
}

// =============================================================================
// Task Status (Test-Verified State)
// =============================================================================

/**
 * TaskStatus represents the verified state of all features and milestones.
 * Stored in status.json (machine-updated, test-verified).
 */
export interface TaskStatus {
	taskId: string;
	lastUpdated: string; // ISO timestamp
	features: Record<string, FeatureStatus>;
	milestones: Record<string, MilestoneStatus>;
}

// =============================================================================
// Progress Log (Append-Only Audit)
// =============================================================================

/**
 * ProgressEntry represents a single append-only entry in progress.md.
 */
export interface ProgressEntry {
	timestamp: string; // ISO timestamp
	type: ProgressEntryType;
	featureId?: string;
	milestoneId?: string;
	summary: string;
	details: ProgressDetails;
}

export type ProgressEntryType =
	| 'initialization'
	| 'feature_attempt'
	| 'feature_passed'
	| 'feature_failed'
	| 'review_approved'
	| 'review_changes_requested'
	| 'review_escalated'
	| 'milestone_completed'
	| 'parallel_exploration'
	| 'human_intervention'
	| 'error';

export interface ProgressDetails {
	// For feature attempts
	approach?: string;
	testCommand?: string;
	testOutput?: string;
	error?: string;
	attempt?: number;
	filesChanged?: string[];
	commits?: string[];

	// For reviews
	reviewerId?: string;
	feedback?: string;
	designDecisions?: string[];

	// For parallel exploration
	optionA?: ParallelOptionDetails;
	optionB?: ParallelOptionDetails;
	winner?: 'a' | 'b';

	// For human intervention
	humanAction?: string;
	humanFeedback?: string;
}

export interface ParallelOptionDetails {
	approach: string;
	passed: boolean;
	cost?: number;
}

// =============================================================================
// Session Context (Regenerated Each Session)
// =============================================================================

/**
 * SessionContext is the hydrated context provided to a worker session.
 * Generated from domain memory at session start.
 */
export interface SessionContext {
	taskId: string;
	taskDescription: string;

	// Current focus
	currentFeature: Feature;
	currentMilestone: MilestoneGoal;
	currentSubtask: SubtaskGoal;

	// Status
	featureStatus: FeatureStatus;
	overallProgress: ProgressSummary;

	// History for current feature
	previousAttempts: ProgressEntry[];
	reviewHistory: ReviewHistorySummary[];

	// Context for implementation
	relevantFiles: RelevantFile[];
	learnings: Learning[];
	recentDecisions: DecisionSummary[];

	// Constraints
	bindingDesignDecisions: DesignDecisionSummary[];
}

export interface ProgressSummary {
	passingFeatures: number;
	totalFeatures: number;
	passingMilestones: number;
	totalMilestones: number;
	percentComplete: number;
}

export interface ReviewHistorySummary {
	attempt: number;
	decision: 'approved' | 'changes_requested' | 'escalate_to_human';
	feedback: string;
	designDecisions: string[];
}

export interface RelevantFile {
	filePath: string;
	relevance: string;
}

export interface Learning {
	id: string;
	category: string;
	content: string;
	source: string;
}

export interface DecisionSummary {
	question: string;
	chosen: string;
	reasoning: string;
	madeBy: 'agent' | 'human' | 'parallel_winner';
}

export interface DesignDecisionSummary {
	id: string;
	category: string;
	decision: string;
	reasoning: string;
}

// =============================================================================
// Session Initialization Result
// =============================================================================

/**
 * Result of initializing a worker session.
 */
export type SessionInitResult = SessionInitSuccess | SessionInitComplete | SessionInitBlocked;

export interface SessionInitSuccess {
	type: 'success';
	context: SessionContext;
	contextMarkdown: string; // Generated context.md content
	todoItems: TodoItem[]; // For TodoWrite projection
}

export interface SessionInitComplete {
	type: 'complete';
	reason: 'all_features_passing';
}

export interface SessionInitBlocked {
	type: 'blocked';
	reason: 'max_attempts_reached' | 'human_review_required' | 'dependency_blocked';
	featureId?: string;
	milestoneId?: string;
	details: string;
}

/**
 * TodoItem for TodoWrite projection.
 */
export interface TodoItem {
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
	activeForm: string;
}

// =============================================================================
// Test Results
// =============================================================================

/**
 * Result of running a feature's testCommand.
 */
export interface TestResult {
	passed: boolean;
	duration: number; // milliseconds
	output: string;
	error?: string;
	exitCode: number;
}

// =============================================================================
// Domain Memory Paths
// =============================================================================

/**
 * Standard paths for domain memory files.
 */
export interface DomainMemoryPaths {
	baseDir: string; // .typedai/memory/{taskId}
	goalsPath: string; // .typedai/memory/{taskId}/goals.yaml
	statusPath: string; // .typedai/memory/{taskId}/status.json
	progressPath: string; // .typedai/memory/{taskId}/progress.md
	contextPath: string; // .typedai/memory/{taskId}/context.md
}

/**
 * Compute domain memory paths for a task.
 */
export function getDomainMemoryPaths(workingDir: string, taskId: string): DomainMemoryPaths {
	const baseDir = `${workingDir}/.typedai/memory/${taskId}`;
	return {
		baseDir,
		goalsPath: `${baseDir}/goals.yaml`,
		statusPath: `${baseDir}/status.json`,
		progressPath: `${baseDir}/progress.md`,
		contextPath: `${baseDir}/context.md`,
	};
}

/**
 * Review file paths.
 */
export interface ReviewPaths {
	baseDir: string; // .typedai/reviews/{taskId}
	featureReviewPath: (featureId: string) => string;
	designDecisionsPath: string;
}

/**
 * Compute review paths for a task.
 */
export function getReviewPaths(workingDir: string, taskId: string): ReviewPaths {
	const baseDir = `${workingDir}/.typedai/reviews/${taskId}`;
	return {
		baseDir,
		featureReviewPath: (featureId: string) => `${baseDir}/feature-${featureId}.json`,
		designDecisionsPath: `${baseDir}/design-decisions.json`,
	};
}
