/**
 * Domain Memory Module
 *
 * Provides cross-session persistence for long-running autonomous coding agents.
 *
 * Key files in .typedai/memory/{taskId}/:
 * - goals.yaml: What we want to achieve (stable, human-editable)
 * - status.json: What's verified true (machine-updated by tests)
 * - progress.md: What happened (append-only audit log)
 * - context.md: What agent needs now (regenerated each session)
 */

// Types
// Note: Learning is exported from core/types, not here, to avoid naming collision
export type {
	DecisionSummary,
	DesignDecisionSummary,
	DomainMemoryPaths,
	Feature,
	FeatureStatus,
	FeatureStatusValue,
	GoalTree,
	MilestoneGoal,
	MilestoneStatus,
	ParallelOptionDetails,
	ProgressDetails,
	ProgressEntry,
	ProgressEntryType,
	ProgressSummary,
	RelevantFile,
	ReviewHistorySummary,
	ReviewPaths,
	SessionContext,
	SessionInitBlocked,
	SessionInitComplete,
	SessionInitResult,
	SessionInitSuccess,
	SubtaskGoal,
	TaskStatus,
	TestResult,
	TodoItem,
} from './types';

export { getDomainMemoryPaths, getReviewPaths } from './types';

// Store operations
export {
	appendMarkdown,
	domainMemoryExists,
	ensureDir,
	fileExists,
	formatProgressEntry,
	initializeDomainMemory,
	initializeReviewStorage,
	loadDesignDecisions,
	loadDomainMemory,
	loadFeatureReviews,
	loadGoals,
	loadJson,
	loadMarkdown,
	loadStatus,
	saveDesignDecisions,
	saveFeatureReviews,
	saveGoals,
	saveJson,
	saveMarkdown,
	saveStatus,
} from './store';

// Goal operations
export {
	checkFeatureDependencies,
	checkMilestoneDependencies,
	createFeature,
	createGoalTree,
	createMilestone,
	createSubtask,
	getAllFeatures,
	getFeatureById,
	getFeaturesInMilestone,
	getGoalTree,
	getGoalTreeStats,
	getMilestoneById,
	getMilestoneForFeature,
	getSubtaskById,
	getSubtaskForFeature,
	setGoalTree,
	validateGoalTree,
} from './goals';

// Status operations
export {
	approveFeature,
	blockFeature,
	getBlockedFeatures,
	getFeaturesByStatus,
	getProgressSummary,
	getTaskStatus,
	hasExceededMaxAttempts,
	initializeStatus,
	isTaskComplete,
	recalculateMilestoneStatus,
	rejectFeature,
	selectNextFeature,
	setTaskStatus,
	startFeature,
	updateFeatureStatusFromTest,
} from './status';

// Progress operations
export {
	appendProgressEntry,
	countFeatureAttempts,
	getFeatureProgress,
	getProgressLog,
	initializeProgressLog,
	logError,
	logFeatureAttempt,
	logFeatureFailed,
	logFeaturePassed,
	logHumanIntervention,
	logInitialization,
	logMilestoneCompleted,
	logParallelExploration,
	logParallelExplorationStarted,
	logParallelExplorationComplete,
	logReviewApproved,
	logReviewChangesRequested,
	logReviewEscalated,
	parseRecentProgress,
} from './progress';

// Context operations
export {
	createCompactContext,
	createWorkerInitialPrompt,
	extractPreviousAttempts,
	generateContextMarkdown,
	generateSessionContext,
	generateSuggestedApproach,
	saveContext,
} from './context';

// Session initialization
export {
	handleDirtyGitState,
	initializeWorkerSession,
	resumeFromCheckpoint,
	validateDomainMemory,
} from './sessionInit';

// TodoWrite projection
export {
	formatTodoItems,
	projectDetailedProgress,
	projectMilestoneToTodoWrite,
	projectSummary,
	projectToTodoWrite,
} from './projection';

// Test runner
export {
	parseTestSummary,
	runFeatureTest,
	runFeatureTests,
	runTestCommand,
} from './testRunner';
