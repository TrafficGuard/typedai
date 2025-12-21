/**
 * Frontend types for NextGen Agent architecture
 */

// ============================================================================
// Decision Types
// ============================================================================

/**
 * Decision tier classifications
 */
export type DecisionTier = 'trivial' | 'minor' | 'medium' | 'major';

/**
 * Status of a decision
 */
export type DecisionStatus = 'pending' | 'approved' | 'overridden';

/**
 * A recorded decision
 */
export interface Decision {
	id: string;
	tier: DecisionTier;
	question: string;
	options: string[];
	chosenOption: string;
	reasoning: string;
	madeBy: 'agent' | 'human';
	reviewStatus: DecisionStatus;
	humanFeedback?: string;
	timestamp: number;
	subtaskId?: string;
}

// ============================================================================
// Parallel Option Types
// ============================================================================

/**
 * Status of a parallel option exploration
 */
export type ParallelOptionStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * A parallel implementation option
 */
export interface ParallelOption {
	id: string;
	name: string;
	description: string;
	pros: string[];
	cons: string[];
	status: ParallelOptionStatus;
	summary?: string;
	diffStats?: {
		filesChanged: number;
		insertions: number;
		deletions: number;
	};
	commits?: string[];
	cost?: number;
	branch?: string;
}

/**
 * State of parallel exploration
 */
export interface ParallelExplorationState {
	taskId: string;
	decisionQuestion: string;
	options: ParallelOption[];
	selectedOptionId?: string;
	complete: boolean;
	totalCost: number;
	startedAt: number;
	completedAt?: number;
}

// ============================================================================
// Task Status Types (Extended for NextGen)
// ============================================================================

/**
 * Extended task status for nextgen architecture
 */
export type NextGenTaskStatus =
	| 'initializing'
	| 'planning'
	| 'in_progress'
	| 'awaiting_selection'
	| 'awaiting_decision'
	| 'awaiting_review'
	| 'reviewing'
	| 'completed'
	| 'failed'
	| 'cancelled';

/**
 * Milestone status
 */
export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

/**
 * A task milestone
 */
export interface Milestone {
	id: string;
	name: string;
	description: string;
	status: MilestoneStatus;
	dependsOn: string[];
	subtaskCount: number;
	completedSubtasks: number;
	requiresHumanReview: boolean;
}

// ============================================================================
// Subtask Types
// ============================================================================

/**
 * Subtask status
 */
export type SubtaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';

/**
 * A subtask within a milestone
 */
export interface Subtask {
	id: string;
	milestoneId: string;
	description: string;
	status: SubtaskStatus;
	branch?: string;
	sessionId?: string;
	startedAt?: number;
	completedAt?: number;
	cost?: number;
}

// ============================================================================
// Review Types
// ============================================================================

/**
 * Review decision
 */
export type ReviewDecision = 'approved' | 'changes_requested' | 'escalate_to_human';

/**
 * Severity of a review issue
 */
export type IssueSeverity = 'error' | 'warning' | 'suggestion';

/**
 * A review issue
 */
export interface ReviewIssue {
	severity: IssueSeverity;
	file: string;
	line?: number;
	message: string;
	suggestion?: string;
}

/**
 * Result of a code review
 */
export interface ReviewResult {
	decision: ReviewDecision;
	confidence: number;
	issues: ReviewIssue[];
	suggestions: string[];
	reasoning: string;
	changesSummary: string;
}

// ============================================================================
// Notification Types
// ============================================================================

/**
 * Notification priority
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Notification type
 */
export type NotificationType =
	| 'task_started'
	| 'task_completed'
	| 'task_failed'
	| 'milestone_completed'
	| 'subtask_completed'
	| 'subtask_failed'
	| 'decision_required'
	| 'parallel_options_ready'
	| 'review_required'
	| 'review_complete'
	| 'error'
	| 'warning'
	| 'info';

/**
 * A notification
 */
export interface AgentNotification {
	id: string;
	type: NotificationType;
	priority: NotificationPriority;
	title: string;
	message: string;
	taskId?: string;
	subtaskId?: string;
	timestamp: number;
	read: boolean;
	actions?: NotificationAction[];
}

/**
 * Action on a notification
 */
export interface NotificationAction {
	label: string;
	type: 'url' | 'callback' | 'api';
	url?: string;
	endpoint?: string;
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
}

// ============================================================================
// NextGen Task State
// ============================================================================

/**
 * Complete state of a NextGen task
 */
export interface NextGenTaskState {
	taskId: string;
	status: NextGenTaskStatus;
	description: string;
	milestones: Milestone[];
	currentMilestoneId?: string;
	activeSubtasks: Subtask[];
	decisions: Decision[];
	parallelExploration?: ParallelExplorationState;
	pendingReview?: ReviewResult;
	notifications: AgentNotification[];
	cost: number;
	startedAt: number;
	updatedAt: number;
}
