/**
 * NextGen Agent Core Types
 *
 * This module defines the type system for the next-generation coding agent architecture.
 * It extends the existing AgentContext with support for:
 * - Smart compaction with context management
 * - Learning extraction and knowledge base integration
 * - Dynamic tool loading with group-based management
 * - Sub-agent orchestration patterns
 */

import type { AgentContext, AgentLLMs, LlmFunctions, TaskLevel } from '#shared/agent/agent.model';
import type { FunctionCallResult, LlmMessage } from '#shared/llm/llm.model';

// ============================================================================
// Compaction Types
// ============================================================================

/**
 * Triggers that can initiate context compaction
 */
export type CompactionTrigger =
	| 'subtask_complete' // Agent marked a sub-task as complete
	| 'token_threshold' // Context exceeded token budget threshold
	| 'iteration_threshold' // Reached iteration count without compaction
	| 'manual'; // Explicitly requested

/**
 * Result of a compaction operation
 */
export interface CompactionResult {
	/** Summary of work completed in compacted iterations */
	completedWorkSummary: string;
	/** Key decisions made during compacted work */
	keyDecisions: string[];
	/** Learnings extracted (if extraction enabled) */
	extractedLearnings: Learning[];
	/** Tool groups that were unloaded during compaction */
	unloadedToolGroups: string[];
	/** Summary of tool usage in compacted iterations */
	toolUsageSummary: string;
	/** Range of iterations that were compacted */
	compactedIterationRange: { start: number; end: number };
	/** Tokens saved by compaction */
	tokensSaved: number;
}

/**
 * Configuration for compaction behavior
 */
export interface CompactionConfig {
	/** Token threshold as percentage of max (0-1, default 0.8) */
	tokenThresholdPercent: number;
	/** Iteration count threshold (default 5) */
	iterationThreshold: number;
	/** Whether to extract learnings on compaction (default true) */
	extractLearnings: boolean;
	/** Whether to remove loaded tool groups on compaction (default true) */
	unloadToolsOnCompaction: boolean;
	/** Number of recent message turns to preserve (default 3) */
	recentTurnsToPreserve: number;
	/** Maximum ephemeral cache markers to keep (default 5) */
	maxEphemeralMarkers: number;
}

// ============================================================================
// Learning Types
// ============================================================================

/**
 * Types of learnings that can be extracted
 */
export type LearningType = 'pattern' | 'pitfall' | 'preference' | 'context';

/**
 * A learning extracted from agent work
 */
export interface Learning {
	/** Unique identifier */
	id: string;
	/** Type of learning */
	type: LearningType;
	/** Category/topic (e.g., 'typescript/testing', 'react/hooks') */
	category: string;
	/** The actual learning content */
	content: string;
	/** Confidence score (0-1) */
	confidence: number;
	/** Tags for retrieval */
	tags: string[];
	/** Source information */
	source: LearningSource;
	/** When the learning was created */
	createdAt: Date;
}

/**
 * Source information for a learning
 */
export interface LearningSource {
	/** Agent that generated the learning */
	agentId: string;
	/** Task description */
	task: string;
	/** Outcome of the task */
	outcome: 'success' | 'partial' | 'failure';
	/** Iteration range where learning was extracted */
	iterationRange?: { start: number; end: number };
}

// ============================================================================
// Tool Loading Types
// ============================================================================

/**
 * A group of related tools that can be loaded together
 */
export interface ToolGroup {
	/** Group identifier (e.g., 'GitHub', 'Git', 'TypeScript') */
	name: string;
	/** Description for the tool index */
	description: string;
	/** List of function names in this group */
	functions: string[];
	/** Cached full schemas (lazy-loaded) */
	schemasCache?: FunctionSchema[];
}

/**
 * Schema for a single function
 */
export interface FunctionSchema {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

/**
 * Tool loading state for an agent
 */
export interface ToolLoadingState {
	/** Currently loaded tool groups */
	activeGroups: Set<string>;
	/** Tool groups used in current iteration range (for compaction tracking) */
	groupsUsedSinceLastCompaction: Set<string>;
	/** Timestamp when each group was loaded */
	loadedAt: Map<string, number>;
}

// ============================================================================
// Sub-Agent Types
// ============================================================================

/**
 * Patterns for sub-agent orchestration
 */
export type SubAgentPattern = 'task_decomposition' | 'multi_perspective' | 'pipeline' | 'specialist';

/**
 * Configuration for a sub-agent
 */
export interface SubAgentConfig {
	/** Display name for the sub-agent */
	name: string;
	/** Role/purpose of this sub-agent */
	role: 'search' | 'analysis' | 'implementation' | 'verification' | 'review' | 'custom';
	/** Custom role description (when role is 'custom') */
	roleDescription?: string;
	/** LLM tier to use */
	llmLevel: TaskLevel;
	/** Maximum iterations allowed */
	maxIterations?: number;
	/** Budget limit (fraction of parent, 0-1) */
	budgetFraction?: number;
	/** Initial context to pass */
	initialContext?: Record<string, unknown>;
}

/**
 * Coordination strategy for multiple sub-agents
 */
export interface SubAgentCoordination {
	/** How sub-agents should execute */
	type: 'parallel' | 'sequential' | 'conditional';
	/** How to combine results */
	aggregation?: 'merge' | 'vote' | 'best' | 'pipeline';
	/** Whether to pass context between sequential agents */
	passContext?: boolean;
}

/**
 * Full configuration for spawning sub-agents
 */
export interface SubAgentSpawnConfig {
	/** Orchestration pattern */
	pattern: SubAgentPattern;
	/** Sub-agent configurations */
	agents: SubAgentConfig[];
	/** Coordination strategy */
	coordination: SubAgentCoordination;
	/** Overall budget for all sub-agents */
	budget?: number;
}

/**
 * Result from a sub-agent execution
 */
export interface SubAgentResult {
	/** Sub-agent identifier */
	agentId: string;
	/** Sub-agent name */
	name: string;
	/** Final output/result */
	output: string;
	/** Structured data if available */
	data?: Record<string, unknown>;
	/** Final state */
	state: 'completed' | 'error' | 'timeout' | 'cancelled';
	/** Error message if failed */
	error?: string;
	/** Cost incurred */
	cost: number;
	/** Iterations used */
	iterations: number;
}

/**
 * Handle to a running sub-agent
 */
export interface SubAgentExecution {
	/** Unique identifier for this execution */
	id: string;
	/** Promise that resolves with the result */
	promise: Promise<SubAgentResult>;
	/** Cancel the sub-agent */
	cancel: () => void;
}

// ============================================================================
// LiveFiles Types
// ============================================================================

/**
 * State of a file in LiveFiles
 */
export interface LiveFileState {
	/** File path relative to working directory */
	path: string;
	/** Content hash for change detection */
	contentHash: string;
	/** Full content (or null if unchanged and using hash reference) */
	content: string | null;
	/** Token count for this file */
	tokens: number;
	/** Whether file has changed since last iteration */
	changed: boolean;
	/** Diff from previous version (if changed) */
	diff?: string;
}

/**
 * LiveFiles configuration and state
 */
export interface LiveFilesState {
	/** Files currently being tracked */
	files: Map<string, LiveFileState>;
	/** Maximum tokens to allocate for LiveFiles */
	maxTokens: number;
	/** Whether to use diff markers for changed files */
	useDiffMarkers: boolean;
	/** Whether to use hash references for unchanged files */
	useHashReferences: boolean;
}

// ============================================================================
// Context Manager Types
// ============================================================================

/**
 * Token budget allocation
 */
export interface TokenBudget {
	/** Maximum tokens for the model */
	maxTokens: number;
	/** Tokens allocated for system prompt */
	systemPromptTokens: number;
	/** Tokens allocated for tool schemas */
	toolSchemaTokens: number;
	/** Tokens allocated for LiveFiles */
	liveFilesTokens: number;
	/** Tokens allocated for compacted history */
	compactedHistoryTokens: number;
	/** Tokens allocated for recent conversation */
	recentConversationTokens: number;
	/** Tokens reserved for response */
	responseReserve: number;
	/** Current total used tokens */
	currentUsed: number;
	/** Available tokens for new content */
	available: number;
}

/**
 * Message stack structure optimized for caching
 */
export interface CacheOptimizedMessageStack {
	/** System prompt with tool index (cached) */
	systemMessage: LlmMessage;
	/** Repository overview (cached) */
	repositoryContext: LlmMessage;
	/** Task description (cached) */
	taskMessage: LlmMessage;
	/** Compacted history from previous work (cached after compaction) */
	compactedContext?: LlmMessage;
	/** Loaded tool group schemas (dynamic) */
	toolSchemas: LlmMessage[];
	/** Recent conversation history (dynamic) */
	recentHistory: LlmMessage[];
	/** Current iteration content (never cached) */
	currentIteration?: LlmMessage;
}

// ============================================================================
// NextGen Agent Context
// ============================================================================

/**
 * Extended agent context for NextGen architecture
 */
export interface NextGenAgentContext extends Omit<AgentContext, 'messages'> {
	/** Maximum iterations allowed for this agent */
	maxIterations: number;

	// Message Management
	/** Cache-optimized message stack */
	messageStack: CacheOptimizedMessageStack;
	/** Flat message array for LLM calls (built from messageStack) */
	messages: LlmMessage[];

	// Compaction State
	/** Compaction configuration */
	compactionConfig: CompactionConfig;
	/** Last iteration when compaction occurred */
	lastCompactionIteration: number;
	/** Accumulated compaction summaries */
	compactedSummaries: string[];

	// Tool Loading State
	/** Dynamic tool loading state */
	toolLoadingState: ToolLoadingState;

	// LiveFiles State
	/** LiveFiles configuration and state */
	liveFilesState: LiveFilesState;

	// Sub-Agent State
	/** Currently running sub-agents */
	activeSubAgents: Map<string, SubAgentExecution>;
	/** Completed sub-agent results */
	completedSubAgentResults: SubAgentResult[];

	// Learning State
	/** Learnings extracted during this session */
	sessionLearnings: Learning[];
	/** Learnings retrieved for this task */
	retrievedLearnings: Learning[];

	// Memory Extensions
	/** Structured memory for sub-task coordination */
	structuredMemory: Record<string, unknown>;
}

// ============================================================================
// Factory and Configuration
// ============================================================================

/**
 * Configuration for creating a NextGen agent
 */
export interface NextGenAgentConfig {
	/** Agent name */
	name: string;
	/** Initial user prompt/task */
	prompt: string;
	/** LLMs for different task levels */
	llms: AgentLLMs;
	/** Functions available to the agent */
	functions: LlmFunctions;
	/** Compaction configuration (uses defaults if not provided) */
	compactionConfig?: Partial<CompactionConfig>;
	/** Maximum iterations before requiring human intervention */
	maxIterations?: number;
	/** Budget in USD */
	budget?: number;
	/** Initial memory state */
	initialMemory?: Record<string, string>;
	/** Parent agent ID if this is a sub-agent */
	parentAgentId?: string;
	/** Project/repository path */
	projectPath?: string;
}

/**
 * Default compaction configuration
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
	tokenThresholdPercent: 0.8,
	iterationThreshold: 5,
	extractLearnings: true,
	unloadToolsOnCompaction: true,
	recentTurnsToPreserve: 3,
	maxEphemeralMarkers: 5,
};

// ============================================================================
// Helper Type Guards
// ============================================================================

export function isNextGenAgentContext(context: AgentContext | NextGenAgentContext): context is NextGenAgentContext {
	return 'messageStack' in context && 'compactionConfig' in context;
}

export function isCompactionTrigger(value: string): value is CompactionTrigger {
	return ['subtask_complete', 'token_threshold', 'iteration_threshold', 'manual'].includes(value);
}

export function isSubAgentPattern(value: string): value is SubAgentPattern {
	return ['task_decomposition', 'multi_perspective', 'pipeline', 'specialist'].includes(value);
}
