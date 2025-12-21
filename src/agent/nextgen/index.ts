/**
 * NextGen Agent Module
 *
 * Session-forking architecture for long-running autonomous coding agents.
 *
 * Key Features:
 * - Task → Milestone → Subtask hierarchy
 * - Session forking using Agent SDK V2
 * - Decision tier system (trivial, minor, medium, major)
 * - AI pre-analysis before parallel exploration
 * - Git worktree-based parallel option implementation
 * - AI-powered code review using knowledge base
 * - Multi-channel notifications
 */

// Core Runtime
export {
	AgentRuntime,
	runNextGenAgent,
	type AgentRuntimeConfig,
	type AgentRunResult,
	type IterationCallback,
} from './core/agentRuntime';

export {
	NextGenOrchestrator,
	createNextGenOrchestrator,
	type NextGenOrchestratorConfig,
	type NextGenOrchestratorState,
	type NextGenEvent,
	type NextGenEventListener,
	type SubtaskMergeResponse,
} from './core/nextGenOrchestrator';

export * from './core/types';

// Agent SDK
export {
	unstable_v2_createSession,
	unstable_v2_resumeSession,
	unstable_v2_prompt,
	extractAssistantText,
	isAssistantMessage,
	isResultMessage,
	isSuccessResult,
	type Session,
	type SessionOptions,
	type ResumeSessionOptions,
	type PromptResult,
} from './agentSdk';

// Task Orchestration
export {
	TaskOrchestrator,
	createTaskOrchestrator,
	createTaskOrchestratorV2,
	isV2Task,
	getTaskDomainMemoryPaths,
	taskHasDomainMemory,
	type TaskOrchestratorConfig,
	type TaskOrchestratorV2Config,
	type OrchestratorEventV2,
	type PlanAdjustment,
} from './orchestrator/taskOrchestrator';

export type {
	Milestone,
	MilestoneStatus,
	TaskDefinition,
	TaskState,
	SubtaskDefinition,
	ScopeDefinition,
	SubtaskContext,
	BranchChanges,
	ScopeChangeRequest,
	Decision,
	DecisionTier,
	OptionDefinition,
	SubtaskResultType,
	// v2 Feature types
	Feature,
	FeatureDefinition,
	GoalTree,
	MilestoneGoal,
	SubtaskGoal,
	DomainMilestoneStatus,
	DomainTaskStatus,
} from './orchestrator/milestone';

export {
	TaskPlanner,
	createTaskPlanner,
	planWithDomainMemory,
	convertTaskToGoalTree,
	type TaskPlannerConfig,
	type TaskPlannerInput,
	type TaskPlannerResult,
	type TaskPlannerV2Config,
	type TaskPlannerV2Result,
} from './orchestrator/taskPlanner';

// v2 Agents
export {
	runInitializerAgent,
	generateTestCommandsForFeatures,
	validateTestCommands,
	type InitializerAgentConfig,
	type InitializerAgentInput,
	type InitializerAgentResult,
} from './orchestrator/initializerAgent';

export {
	runWorkerAgent,
	runWorkerLoop,
	type WorkerAgentConfig,
	type WorkerAgentResult,
	type WorkerAgentOptions,
	type WorkerLoopResult,
} from './orchestrator/workerAgent';

// Subtask Sessions
export {
	SubtaskSession,
	createSubtaskSession,
	resumeSubtaskSession,
	SubtaskSessionFactory,
	type SubtaskSessionConfig,
	type SubtaskExecutionResult,
} from './subtask/subtaskSession';

export {
	GitBranchingService,
	createSubtaskBranchName,
	extractSubtaskId,
	completeSubtask,
	abortSubtask,
	type GitOptions,
	type DiffStats,
	type WorktreeInfo,
} from './subtask/gitBranching';

// Decision System
export {
	DecisionManager,
	createDecisionManager,
	type DecisionManagerConfig,
	type MakeDecisionInput,
	type MakeDecisionResult,
	type HumanInputCallback,
	type ParallelExplorationCallback,
} from './decisions/decisionManager';

export {
	DecisionAnalyzer,
	createDecisionAnalyzer,
	stringsToOptionDefinitions,
	buildDecisionFromAnalysis,
	type DecisionAnalyzerConfig,
	type DecisionAnalysisInput,
	type DecisionAnalysisResult,
	type OptionAnalysis,
} from './decisions/decisionAnalyzer';

export {
	classifyDecision,
	classifyDecisions,
	getHighestTier,
	requiresHumanInput,
	shouldRecord,
	mayTriggerParallel,
	getTierDisplayName,
	getTierColor,
	type DecisionInput,
	type ClassificationResult,
} from './decisions/decisionTierClassifier';

// Parallel Exploration
export {
	GitWorktreeService,
	createGitWorktreeService,
	type GitWorktreeServiceConfig,
	type CreateWorktreeOptions,
	type Worktree,
	type GitWorktreeInfo,
	type WorktreeDiffStats,
} from './parallel/gitWorktreeService';

export {
	ParallelExplorer,
	createParallelExplorer,
	// v2 Feature-based exploration
	exploreFeatureApproaches,
	finalizeFeatureExploration,
	type ParallelExplorerConfig,
	type ParallelExplorationContext,
	type ParallelExplorationResult,
	type OptionExplorationResult,
	type OptionExplorationStatus,
	type SelectionCallback,
	type StatusCallback,
	// v2 Types
	type FeatureExplorationConfig,
	type FeatureApproach,
	type FeatureExplorationInput,
	type ApproachExplorationResult,
	type FeatureExplorationResult,
} from './parallel/parallelExplorer';

// AI Review
export {
	AIReviewer,
	createAIReviewer,
	type AIReviewerConfig,
	type BranchReviewInput,
	type AIReviewResult,
	type AIReviewIssue,
	type IssueSeverity,
	// v2 Review exports
	runReviewAgent,
	loadReviewHistory,
	addReviewRecord,
	getBindingDecisions,
	checkForContradictions,
	formatContradictionForReview,
	type ReviewAgentConfig,
	type ReviewAgentInput,
	type ReviewResult,
	type ReviewRecord,
	type ReviewIssue,
	type DesignDecision,
	type FeatureReviewHistory,
	type ContradictionCheckResult,
} from './review/index';

// Domain Memory (v2)
export * from './memory/index';

// Notifications
export {
	NotificationService,
	createNotificationService,
	getNotificationService,
	type NotificationServiceConfig,
	type Notification,
	type NotificationResult,
	type NotificationAction,
	type NotificationType,
	type NotificationPriority,
	type NotificationChannel,
	type ChannelResult,
} from './notifications/notificationService';

// Knowledge Base (re-export)
export { KnowledgeBase, type KnowledgeBaseConfig, type RetrievalQuery } from './learning/knowledgeBase';

// Context Management
export { ContextManager, type ContextManagerConfig } from './context/contextManager';
export { CompactionService, type CompactionServiceConfig } from './context/compactionService';

// Tool Loading
export { ToolLoader, type ToolLoaderConfig } from './tools/toolLoader';
// Note: ToolGroup is already exported via './core/types'
export { TOOL_GROUPS, getToolGroup, buildToolIndex, suggestToolGroups } from './tools/toolGroups';

// Learning System
export { LearningExtractor, type LearningExtractorConfig } from './learning/learningExtractor';
