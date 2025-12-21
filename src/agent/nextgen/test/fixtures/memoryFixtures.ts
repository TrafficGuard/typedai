/**
 * Memory Test Fixtures
 *
 * Provides factory functions for creating test instances of domain memory types.
 */

import type {
	DecisionSummary,
	DesignDecisionSummary,
	Feature,
	FeatureStatus,
	FeatureStatusValue,
	GoalTree,
	Learning,
	MilestoneGoal,
	MilestoneStatus,
	ProgressDetails,
	ProgressEntry,
	ProgressEntryType,
	ProgressSummary,
	RelevantFile,
	ReviewHistorySummary,
	SessionContext,
	SubtaskGoal,
	TaskStatus,
	TestResult,
} from '../../memory/types';

// =============================================================================
// Feature Fixtures
// =============================================================================

/**
 * Create a test feature.
 */
export function createTestFeature(overrides: Partial<Feature> = {}): Feature {
	return {
		id: overrides.id ?? 'ft-1',
		description: overrides.description ?? 'Test feature description',
		testCommand: overrides.testCommand ?? 'pnpm test -- --grep "ft-1"',
		dependsOn: overrides.dependsOn ?? [],
		estimatedComplexity: overrides.estimatedComplexity ?? 'medium',
	};
}

/**
 * Create multiple test features with sequential IDs.
 */
export function createTestFeatures(count: number, prefix = 'ft', options: Partial<Feature> = {}): Feature[] {
	return Array.from({ length: count }, (_, i) =>
		createTestFeature({
			id: `${prefix}-${i + 1}`,
			description: `Feature ${i + 1} description`,
			testCommand: `pnpm test -- --grep "${prefix}-${i + 1}"`,
			...options,
		}),
	);
}

/**
 * Create a feature with dependencies.
 */
export function createDependentFeature(id: string, dependsOn: string[], overrides: Partial<Feature> = {}): Feature {
	return createTestFeature({
		id,
		dependsOn,
		...overrides,
	});
}

// =============================================================================
// Subtask Fixtures
// =============================================================================

/**
 * Create a test subtask.
 */
export function createTestSubtask(overrides: Partial<SubtaskGoal> = {}): SubtaskGoal {
	return {
		id: overrides.id ?? 'st-1',
		name: overrides.name ?? 'Test Subtask',
		description: overrides.description ?? 'Test subtask description',
		features: overrides.features ?? [createTestFeature()],
	};
}

/**
 * Create a subtask with multiple features.
 */
export function createSubtaskWithFeatures(id: string, featureCount: number, overrides: Partial<SubtaskGoal> = {}): SubtaskGoal {
	return createTestSubtask({
		id,
		name: `Subtask ${id}`,
		features: createTestFeatures(featureCount, `${id}-ft`),
		...overrides,
	});
}

// =============================================================================
// Milestone Fixtures
// =============================================================================

/**
 * Create a test milestone.
 */
export function createTestMilestone(overrides: Partial<MilestoneGoal> = {}): MilestoneGoal {
	return {
		id: overrides.id ?? 'ms-1',
		name: overrides.name ?? 'Test Milestone',
		description: overrides.description ?? 'Test milestone description',
		requiresHumanReview: overrides.requiresHumanReview ?? false,
		dependsOn: overrides.dependsOn ?? [],
		completionCriteria: overrides.completionCriteria ?? [],
		subtasks: overrides.subtasks ?? [createTestSubtask()],
	};
}

/**
 * Create a milestone with dependent milestones.
 */
export function createDependentMilestone(id: string, dependsOn: string[], overrides: Partial<MilestoneGoal> = {}): MilestoneGoal {
	return createTestMilestone({
		id,
		name: `Milestone ${id}`,
		dependsOn,
		...overrides,
	});
}

// =============================================================================
// GoalTree Fixtures
// =============================================================================

/**
 * Create a minimal test goal tree.
 */
export function createTestGoalTree(overrides: Partial<GoalTree> = {}): GoalTree {
	return {
		task: overrides.task ?? 'Test Task',
		description: overrides.description ?? 'Test task description',
		createdAt: overrides.createdAt ?? new Date().toISOString(),
		milestones: overrides.milestones ?? [createTestMilestone()],
		constraints: overrides.constraints,
		preferences: overrides.preferences,
	};
}

/**
 * Create a simple goal tree with 1 milestone, 1 subtask, 2 features.
 */
export function createSimpleGoalTree(): GoalTree {
	return createTestGoalTree({
		task: 'Simple Task',
		milestones: [
			createTestMilestone({
				id: 'ms-1',
				name: 'Milestone 1',
				subtasks: [
					createTestSubtask({
						id: 'ms-1-st-1',
						features: [createTestFeature({ id: 'ms-1-st-1-ft-1' }), createTestFeature({ id: 'ms-1-st-1-ft-2' })],
					}),
				],
			}),
		],
	});
}

/**
 * Create a complex goal tree with dependencies.
 */
export function createComplexGoalTree(): GoalTree {
	return createTestGoalTree({
		task: 'Complex Task',
		description: 'A task with multiple milestones and dependencies',
		milestones: [
			createTestMilestone({
				id: 'ms-1',
				name: 'Foundation',
				subtasks: [
					createTestSubtask({
						id: 'ms-1-st-1',
						features: [createTestFeature({ id: 'ms-1-st-1-ft-1' }), createDependentFeature('ms-1-st-1-ft-2', ['ms-1-st-1-ft-1'])],
					}),
				],
			}),
			createDependentMilestone('ms-2', ['ms-1'], {
				name: 'Core Features',
				subtasks: [
					createTestSubtask({
						id: 'ms-2-st-1',
						features: [createTestFeature({ id: 'ms-2-st-1-ft-1' }), createTestFeature({ id: 'ms-2-st-1-ft-2' })],
					}),
				],
			}),
			createDependentMilestone('ms-3', ['ms-2'], {
				name: 'Polish',
				requiresHumanReview: true,
				subtasks: [
					createTestSubtask({
						id: 'ms-3-st-1',
						features: [createTestFeature({ id: 'ms-3-st-1-ft-1' })],
					}),
				],
			}),
		],
	});
}

/**
 * Create a goal tree with circular dependencies (for testing validation).
 */
export function createCircularGoalTree(): GoalTree {
	return createTestGoalTree({
		task: 'Circular Task',
		milestones: [createDependentMilestone('ms-1', ['ms-2']), createDependentMilestone('ms-2', ['ms-1'])],
	});
}

// =============================================================================
// FeatureStatus Fixtures
// =============================================================================

/**
 * Create a test feature status.
 */
export function createTestFeatureStatus(overrides: Partial<FeatureStatus> = {}): FeatureStatus {
	return {
		status: overrides.status ?? 'pending',
		attempts: overrides.attempts ?? 0,
		maxAttempts: overrides.maxAttempts ?? 3,
		commits: overrides.commits ?? [],
		lastTest: overrides.lastTest,
		lastTestDuration: overrides.lastTestDuration,
		lastError: overrides.lastError,
	};
}

/**
 * Create a passing feature status.
 */
export function createPassingFeatureStatus(): FeatureStatus {
	return createTestFeatureStatus({
		status: 'passing',
		attempts: 1,
		lastTest: new Date().toISOString(),
		lastTestDuration: 1234,
	});
}

/**
 * Create a failing feature status.
 */
export function createFailingFeatureStatus(error = 'Test failed'): FeatureStatus {
	return createTestFeatureStatus({
		status: 'failing',
		attempts: 1,
		lastError: error,
		lastTest: new Date().toISOString(),
		lastTestDuration: 567,
	});
}

// =============================================================================
// TaskStatus Fixtures
// =============================================================================

/**
 * Create a test task status.
 */
export function createTestTaskStatus(overrides: Partial<TaskStatus> = {}): TaskStatus {
	return {
		taskId: overrides.taskId ?? 'test-task',
		lastUpdated: overrides.lastUpdated ?? new Date().toISOString(),
		features: overrides.features ?? {
			'ft-1': createTestFeatureStatus(),
		},
		milestones: overrides.milestones ?? {
			'ms-1': { status: 'pending', passing: 0, total: 1 },
		},
	};
}

/**
 * Create a task status from a goal tree with all features in specified status.
 */
export function createTaskStatusFromGoals(
	goals: GoalTree,
	defaultStatus: FeatureStatusValue = 'pending',
	statusOverrides: Record<string, FeatureStatusValue> = {},
): TaskStatus {
	const features: Record<string, FeatureStatus> = {};
	const milestones: Record<string, MilestoneStatus> = {};

	for (const milestone of goals.milestones) {
		let passing = 0;
		let total = 0;

		for (const subtask of milestone.subtasks) {
			for (const feature of subtask.features) {
				const status = statusOverrides[feature.id] ?? defaultStatus;
				features[feature.id] = createTestFeatureStatus({ status });
				total++;
				if (status === 'passing') passing++;
			}
		}

		milestones[milestone.id] = {
			status: passing === total ? 'passing' : passing > 0 ? 'in_progress' : 'pending',
			passing,
			total,
		};
	}

	return {
		taskId: 'test-task',
		lastUpdated: new Date().toISOString(),
		features,
		milestones,
	};
}

// =============================================================================
// TestResult Fixtures
// =============================================================================

/**
 * Create a passing test result.
 */
export function createPassingTestResult(overrides: Partial<TestResult> = {}): TestResult {
	return {
		passed: true,
		duration: overrides.duration ?? 1500,
		output: overrides.output ?? 'All tests passed\n  2 passing (1s)',
		exitCode: 0,
	};
}

/**
 * Create a failing test result.
 */
export function createFailingTestResult(error = 'Expected 1 to equal 2', overrides: Partial<TestResult> = {}): TestResult {
	return {
		passed: false,
		duration: overrides.duration ?? 2000,
		output: overrides.output ?? `1 failing\n  1) Test case\n    AssertionError: ${error}`,
		error,
		exitCode: 1,
	};
}

// =============================================================================
// Progress Fixtures
// =============================================================================

/**
 * Create a test progress entry.
 */
export function createTestProgressEntry(overrides: Partial<ProgressEntry> = {}): ProgressEntry {
	return {
		timestamp: overrides.timestamp ?? new Date().toISOString(),
		type: overrides.type ?? 'feature_attempt',
		featureId: overrides.featureId ?? 'ft-1',
		summary: overrides.summary ?? 'Test progress entry',
		details: overrides.details ?? {},
	};
}

/**
 * Create a feature attempt progress entry.
 */
export function createFeatureAttemptEntry(featureId: string, attempt: number): ProgressEntry {
	return createTestProgressEntry({
		type: 'feature_attempt',
		featureId,
		summary: `Starting attempt ${attempt}`,
		details: { attempt },
	});
}

/**
 * Create a feature passed progress entry.
 */
export function createFeaturePassedEntry(featureId: string, filesChanged: string[]): ProgressEntry {
	return createTestProgressEntry({
		type: 'feature_passed',
		featureId,
		summary: `Feature ${featureId} passed tests`,
		details: { filesChanged },
	});
}

// =============================================================================
// Session Context Fixtures
// =============================================================================

/**
 * Create a minimal session context.
 */
export function createTestSessionContext(overrides: Partial<SessionContext> = {}): SessionContext {
	const goals = createSimpleGoalTree();
	const status = createTaskStatusFromGoals(goals);
	const feature = goals.milestones[0].subtasks[0].features[0];

	return {
		taskId: overrides.taskId ?? 'test-task',
		taskDescription: overrides.taskDescription ?? 'Test task',
		currentFeature: overrides.currentFeature ?? feature,
		currentMilestone: overrides.currentMilestone ?? goals.milestones[0],
		currentSubtask: overrides.currentSubtask ?? goals.milestones[0].subtasks[0],
		featureStatus: overrides.featureStatus ?? createTestFeatureStatus(),
		overallProgress: overrides.overallProgress ?? {
			passingFeatures: 0,
			totalFeatures: 2,
			passingMilestones: 0,
			totalMilestones: 1,
			percentComplete: 0,
		},
		previousAttempts: overrides.previousAttempts ?? [],
		reviewHistory: overrides.reviewHistory ?? [],
		relevantFiles: overrides.relevantFiles ?? [],
		learnings: overrides.learnings ?? [],
		recentDecisions: overrides.recentDecisions ?? [],
		bindingDesignDecisions: overrides.bindingDesignDecisions ?? [],
	};
}

// =============================================================================
// Learning/Decision Fixtures
// =============================================================================

/**
 * Create a test learning.
 */
export function createTestLearning(overrides: Partial<Learning> = {}): Learning {
	return {
		id: overrides.id ?? 'learning-1',
		category: overrides.category ?? 'pattern',
		content: overrides.content ?? 'Always use async/await over callbacks',
		source: overrides.source ?? 'code_review',
	};
}

/**
 * Create a test design decision summary.
 */
export function createTestDesignDecision(overrides: Partial<DesignDecisionSummary> = {}): DesignDecisionSummary {
	return {
		id: overrides.id ?? 'decision-1',
		category: overrides.category ?? 'architecture',
		decision: overrides.decision ?? 'Use dependency injection',
		reasoning: overrides.reasoning ?? 'Improves testability',
	};
}

/**
 * Create a test review history summary.
 */
export function createTestReviewHistory(overrides: Partial<ReviewHistorySummary> = {}): ReviewHistorySummary {
	return {
		attempt: overrides.attempt ?? 1,
		decision: overrides.decision ?? 'approved',
		feedback: overrides.feedback ?? 'LGTM',
		designDecisions: overrides.designDecisions ?? [],
	};
}
