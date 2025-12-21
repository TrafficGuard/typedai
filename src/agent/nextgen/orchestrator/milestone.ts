/**
 * Milestone Model
 *
 * Task hierarchy: Task → Milestone → Subtask → Feature
 *
 * v2.0 adds the Feature level as the atomic unit of work with test binding.
 * Features have testCommands that verify completion, enabling test-bound status.
 */

import type { Learning } from '../learning/knowledgeBase';
import type { Subtask } from '../subtask/subtask.model';

// Re-export domain memory types for convenience
export type {
	Feature,
	FeatureStatus,
	FeatureStatusValue,
	GoalTree,
	MilestoneGoal,
	MilestoneStatus as DomainMilestoneStatus,
	SubtaskGoal,
	TaskStatus as DomainTaskStatus,
} from '../memory/types.js';

// ============================================================================
// Milestone Types
// ============================================================================

/**
 * Status of a milestone
 */
export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

/**
 * A milestone is a significant deliverable that may require multiple subtasks
 */
export interface Milestone {
	/** Unique identifier */
	id: string;
	/** Human-readable name */
	name: string;
	/** Detailed description */
	description: string;
	/** Current status */
	status: MilestoneStatus;
	/** Milestone IDs this depends on (must complete before this can start) */
	dependsOn: string[];
	/** Subtask definitions for this milestone */
	subtasks: SubtaskDefinition[];
	/** Whether this milestone requires human review before completion */
	requiresHumanReview: boolean;
	/** Criteria that define when this milestone is "done" */
	completionCriteria: string[];
	/** When milestone was started */
	startedAt?: number;
	/** When milestone was completed */
	completedAt?: number;
}

/**
 * Definition for a subtask (not yet started)
 */
export interface SubtaskDefinition {
	/** Unique identifier */
	id: string;
	/** Subtask name (v2) */
	name?: string;
	/** Description of what this subtask should accomplish */
	description: string;
	/** Acceptance criteria - how to verify the subtask is complete */
	acceptanceCriteria?: string;
	/** Expected files/areas to modify */
	expectedScope: ScopeDefinition;
	/** Subtask IDs this depends on within the milestone */
	dependsOn: string[];
	/** Estimated complexity: simple, moderate, complex */
	complexity: 'simple' | 'moderate' | 'complex';
	/**
	 * Features within this subtask (v2).
	 * Features are the atomic unit of work with test binding.
	 */
	features?: FeatureDefinition[];
}

/**
 * Definition for a feature (v2) - the atomic unit of work with test binding.
 *
 * Each feature has exactly one testCommand that verifies completion.
 * Status can ONLY change via test results + review agent approval.
 */
export interface FeatureDefinition {
	/** Unique identifier */
	id: string;
	/** Description of what this feature should accomplish */
	description: string;
	/** Command to run to verify this feature works */
	testCommand: string;
	/** Feature IDs this depends on */
	dependsOn: string[];
	/** Estimated complexity */
	estimatedComplexity: 'low' | 'medium' | 'high';
}

/**
 * Scope definition constrains what a subtask can/should touch
 */
export interface ScopeDefinition {
	/** Glob patterns for files expected to be modified */
	expectedFiles: string[];
	/** Logical components or areas */
	expectedComponents: string[];
	/** Glob patterns for files that should NOT be touched */
	forbiddenPaths: string[];
	/** Maximum iterations before scope warning */
	maxIterations: number;
	/** Maximum cost before scope warning */
	maxCost: number;
}

// ============================================================================
// Task Definition Types
// ============================================================================

/**
 * A complete task definition with milestones
 */
export interface TaskDefinition {
	/** Unique identifier */
	id: string;
	/** Original user request / task description */
	description: string;
	/** Milestones that comprise this task */
	milestones: Milestone[];
	/** Decisions made during this task */
	decisions: Decision[];
	/** Critical context that all subtasks need (never compacted) */
	pinnedContext: PinnedContextItem[];
	/** When task was created */
	createdAt: number;
	/** When task was completed */
	completedAt?: number;
}

/**
 * Task runtime state (persisted)
 */
export interface TaskState {
	/** Task definition */
	task: TaskDefinition;
	/** Current milestone being worked on */
	currentMilestoneId?: string;
	/** Completed subtasks by ID */
	completedSubtasks: Record<string, Subtask>;
	/** Active subtask sessions */
	activeSubtaskIds: string[];
	/** Total cost incurred */
	totalCost: number;
	/** Total iterations */
	totalIterations: number;
}

// ============================================================================
// Decision Types
// ============================================================================

/**
 * Decision tier classification
 */
export type DecisionTier = 'trivial' | 'minor' | 'medium' | 'major';

/**
 * Review status for a decision
 */
export type DecisionReviewStatus = 'pending' | 'approved' | 'overridden';

/**
 * A recorded decision made during task execution
 */
export interface Decision {
	/** Unique identifier */
	id: string;
	/** Decision tier */
	tier: DecisionTier;
	/** The question/choice being decided */
	question: string;
	/** Available options */
	options: string[];
	/** Chosen option */
	chosenOption: string;
	/** Reasoning for the choice */
	reasoning: string;
	/** Who made the decision */
	madeBy: 'agent' | 'human' | 'parallel_winner';
	/** Review status (for async human review) */
	reviewStatus: DecisionReviewStatus;
	/** When the decision was made */
	timestamp: number;
	/** Subtask ID where decision was made */
	subtaskId?: string;
	/** Feature ID where decision was made (v2) */
	featureId?: string;
	/** Human feedback if overridden */
	humanFeedback?: string;
}

// ============================================================================
// Pinned Context Types
// ============================================================================

/**
 * A piece of context that should never be compacted
 */
export interface PinnedContextItem {
	/** Unique key for this context */
	key: string;
	/** The content to preserve */
	content: string;
	/** Why this is critical */
	reason: string;
	/** When it was added */
	addedAt: number;
	/** Which subtask/component added it */
	addedBy: string;
}

// ============================================================================
// Subtask Session Types
// ============================================================================

/**
 * Result of a completed subtask session
 */
export type SubtaskResultType = 'completed' | 'scope_change_needed' | 'blocked' | 'failed';

/**
 * A request to change scope mid-subtask
 */
export interface ScopeChangeRequest {
	/** What additional scope is needed */
	additionalScope: Partial<ScopeDefinition>;
	/** Why the change is necessary */
	reason: string;
	/** Impact on the subtask */
	impact: string;
	/** Whether this is a blocker or optional */
	blocking: boolean;
}

/**
 * Changes made by a subtask
 */
export interface BranchChanges {
	/** Files modified */
	filesChanged: string[];
	/** Lines added */
	linesAdded: number;
	/** Lines removed */
	linesRemoved: number;
	/** Commits made */
	commits: string[];
	/** Git diff summary */
	diffSummary: string;
}

/**
 * Context injected into a forked subtask session
 */
export interface SubtaskContext {
	/** Original parent task description */
	parentTask: string;
	/** This subtask's specific goal */
	subtaskDescription: string;
	/** Git branch name */
	branch: string;
	/** Scope constraints */
	scope: ScopeDefinition;
	/** Relevant learnings from knowledge base */
	knowledgeBase: Learning[];
	/** Decisions made so far in this task */
	decisions: Decision[];
	/** Additional system prompt text */
	systemPromptAddition: string;
	/** Base commit for this subtask */
	baseCommit: string;
	/** Parent milestone info */
	milestone: {
		id: string;
		name: string;
		description: string;
	};
}

// ============================================================================
// Option/Parallel Exploration Types
// ============================================================================

/**
 * Definition of an option for parallel exploration
 */
export interface OptionDefinition {
	/** Unique ID */
	id: string;
	/** Name of this option */
	name: string;
	/** Description of the approach */
	description: string;
	/** Pros of this approach */
	pros: string[];
	/** Cons of this approach */
	cons: string[];
}

/**
 * Result of a parallel exploration
 */
export interface ParallelExplorationResult {
	/** Option ID */
	optionId: string;
	/** Option name */
	optionName: string;
	/** Worktree path used */
	worktreePath: string;
	/** Branch name */
	branch: string;
	/** Whether implementation succeeded */
	success: boolean;
	/** Changes made */
	changes?: BranchChanges;
	/** Error if failed */
	error?: string;
	/** Cost incurred */
	cost: number;
}

// ============================================================================
// Defaults & Helpers
// ============================================================================

/**
 * Default scope definition
 */
export const DEFAULT_SCOPE: ScopeDefinition = {
	expectedFiles: [],
	expectedComponents: [],
	forbiddenPaths: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
	maxIterations: 20,
	maxCost: 5.0,
};

/**
 * Creates an empty task state
 */
export function createEmptyTaskState(task: TaskDefinition): TaskState {
	return {
		task,
		currentMilestoneId: undefined,
		completedSubtasks: {},
		activeSubtaskIds: [],
		totalCost: 0,
		totalIterations: 0,
	};
}

/**
 * Gets the next available milestone (all dependencies met)
 */
export function getNextMilestone(task: TaskDefinition): Milestone | null {
	const completedIds = new Set(task.milestones.filter((m) => m.status === 'completed').map((m) => m.id));

	for (const milestone of task.milestones) {
		if (milestone.status !== 'pending') continue;

		const allDependenciesMet = milestone.dependsOn.every((depId) => completedIds.has(depId));
		if (allDependenciesMet) {
			return milestone;
		}
	}

	return null;
}

/**
 * Gets milestones that are blocked
 */
export function getBlockedMilestones(task: TaskDefinition): Milestone[] {
	return task.milestones.filter((m) => m.status === 'blocked');
}

/**
 * Checks if all milestones are complete
 */
export function isTaskComplete(task: TaskDefinition): boolean {
	return task.milestones.every((m) => m.status === 'completed');
}

/**
 * Gets task progress summary
 */
export function getTaskProgress(task: TaskDefinition): {
	total: number;
	completed: number;
	inProgress: number;
	pending: number;
	blocked: number;
	percentComplete: number;
} {
	const milestones = task.milestones;
	const total = milestones.length;
	const completed = milestones.filter((m) => m.status === 'completed').length;
	const inProgress = milestones.filter((m) => m.status === 'in_progress').length;
	const pending = milestones.filter((m) => m.status === 'pending').length;
	const blocked = milestones.filter((m) => m.status === 'blocked').length;

	return {
		total,
		completed,
		inProgress,
		pending,
		blocked,
		percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
	};
}

// ============================================================================
// Feature Helpers (v2)
// ============================================================================

/**
 * Get all features from a task definition (v2)
 */
export function getAllFeaturesFromTask(task: TaskDefinition): FeatureDefinition[] {
	const features: FeatureDefinition[] = [];
	for (const milestone of task.milestones) {
		for (const subtask of milestone.subtasks) {
			if (subtask.features) {
				features.push(...subtask.features);
			}
		}
	}
	return features;
}

/**
 * Get a feature by ID from a task definition (v2)
 */
export function getFeatureById(task: TaskDefinition, featureId: string): FeatureDefinition | null {
	for (const milestone of task.milestones) {
		for (const subtask of milestone.subtasks) {
			if (subtask.features) {
				const feature = subtask.features.find((f) => f.id === featureId);
				if (feature) return feature;
			}
		}
	}
	return null;
}

/**
 * Get the milestone containing a feature (v2)
 */
export function getMilestoneForFeature(task: TaskDefinition, featureId: string): Milestone | null {
	for (const milestone of task.milestones) {
		for (const subtask of milestone.subtasks) {
			if (subtask.features?.some((f) => f.id === featureId)) {
				return milestone;
			}
		}
	}
	return null;
}

/**
 * Get the subtask containing a feature (v2)
 */
export function getSubtaskForFeature(task: TaskDefinition, featureId: string): SubtaskDefinition | null {
	for (const milestone of task.milestones) {
		for (const subtask of milestone.subtasks) {
			if (subtask.features?.some((f) => f.id === featureId)) {
				return subtask;
			}
		}
	}
	return null;
}

/**
 * Check if a task uses features (v2 mode)
 */
export function taskHasFeatures(task: TaskDefinition): boolean {
	return task.milestones.some((m) => m.subtasks.some((s) => s.features && s.features.length > 0));
}
