/**
 * Subtask Session
 *
 * Wraps a forked Claude Code session for executing a subtask.
 * Uses the Agent SDK V2 wrapper for session management.
 */

import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { McpServerConfig, Session } from '../agentSdk';
import { unstable_v2_createSession, unstable_v2_resumeSession } from '../agentSdk';
import type { BranchChanges, ScopeChangeRequest, ScopeDefinition, SubtaskContext, SubtaskResultType } from '../orchestrator/milestone';
import { createRepositoryToolsServer } from '../tools/repositoryTools';
import { type GitBranchingService, createSubtaskBranchName } from './gitBranching';

// ============================================================================
// Subtask Session Types
// ============================================================================

/**
 * Result from executing a subtask
 */
export interface SubtaskExecutionResult {
	/** Outcome type */
	result: SubtaskResultType;
	/** Changes made (if completed) */
	changes?: BranchChanges;
	/** Scope change request (if scope_change_needed) */
	scopeChangeRequest?: ScopeChangeRequest;
	/** Error message (if failed) */
	error?: string;
	/** Summary of work done */
	summary: string;
}

/**
 * Configuration for subtask session
 */
export interface SubtaskSessionConfig {
	/** Git branching service */
	git: GitBranchingService;
	/** Working directory */
	workingDirectory: string;
	/** Maximum iterations before auto-pause */
	maxIterations: number;
	/** Maximum cost before auto-pause */
	maxCost: number;
	/** Claude model to use for sessions */
	model?: string;
	/** LLMs to use for repository tools (defaults to defaultLLMs()) */
	llms?: AgentLLMs;
	/** Additional MCP servers to include in sessions */
	additionalMcpServers?: Record<string, McpServerConfig>;
}

// ============================================================================
// Subtask Session Implementation
// ============================================================================

/**
 * A session for executing a subtask
 */
export class SubtaskSession {
	/** Unique session ID */
	readonly id: string;
	/** Subtask ID this session is for */
	readonly subtaskId: string;
	/** Parent task ID */
	readonly parentTaskId: string;
	/** Git branch for this subtask */
	readonly branch: string;
	/** Base commit */
	readonly baseCommit: string;
	/** Worktree path (if using worktrees for parallel exploration) */
	readonly worktreePath?: string;

	/** Cost incurred so far */
	cost = 0;
	/** Iterations completed */
	iterations = 0;

	/**
	 * Gets the underlying SDK session (for forking during parallel exploration).
	 * Returns undefined if session not yet created.
	 */
	getSession(): Session | undefined {
		return this.session ?? undefined;
	}

	private context: SubtaskContext;
	private config: SubtaskSessionConfig;
	private session: Session | null = null;
	private cancelled = false;
	private resumedFromId?: string;

	constructor(subtaskId: string, parentTaskId: string, context: SubtaskContext, config: SubtaskSessionConfig, resumedFromId?: string) {
		this.id = `session-${subtaskId}-${Date.now()}`;
		this.subtaskId = subtaskId;
		this.parentTaskId = parentTaskId;
		this.context = context;
		this.config = config;
		this.branch = context.branch;
		this.baseCommit = context.baseCommit;
		this.resumedFromId = resumedFromId;
	}

	/**
	 * Creates and initializes the SDK session
	 */
	async fork(): Promise<void> {
		logger.info({ subtaskId: this.subtaskId, branch: this.branch }, 'Forking subtask session');

		// Create git branch for this subtask
		const git = this.config.git;
		await git.createSubtaskBranch(this.branch);

		// Create SDK session with subtask context
		const initialPrompt = this.buildInitialPrompt();

		const model = this.config.model ?? 'claude-sonnet-4-20250514';

		// Build MCP servers for the session
		const mcpServers: Record<string, McpServerConfig> = {
			...this.config.additionalMcpServers,
		};

		// Add repository tools (uses defaultLLMs if not configured)
		const llms = this.config.llms ?? defaultLLMs();
		const repositoryTools = createRepositoryToolsServer({ llms });
		mcpServers['repository-tools'] = repositoryTools;

		if (this.resumedFromId) {
			// Resume existing session
			this.session = await unstable_v2_resumeSession(this.resumedFromId, {
				model,
				cwd: this.worktreePath ?? this.config.workingDirectory,
				mcpServers,
			});
		} else {
			// Create new session
			this.session = await unstable_v2_createSession({
				model,
				cwd: this.worktreePath ?? this.config.workingDirectory,
				systemPrompt: this.context.systemPromptAddition,
				mcpServers,
			});
		}

		logger.info({ sessionId: this.session.sessionId, subtaskId: this.subtaskId }, 'SDK session created with repository tools');
	}

	/**
	 * Executes the subtask to completion
	 */
	async execute(): Promise<SubtaskExecutionResult> {
		if (!this.session) {
			throw new Error('Session not forked - call fork() first');
		}

		logger.info({ subtaskId: this.subtaskId }, 'Starting subtask execution');

		try {
			// Send initial prompt if not resumed
			if (!this.resumedFromId) {
				const initialPrompt = this.buildInitialPrompt();
				await this.sendMessage(initialPrompt);
			}

			// Execute until completion or limit
			while (!this.cancelled) {
				// Check limits
				if (this.iterations >= this.config.maxIterations) {
					logger.warn({ subtaskId: this.subtaskId, iterations: this.iterations }, 'Max iterations reached');
					return {
						result: 'blocked',
						summary: `Reached maximum iterations (${this.config.maxIterations})`,
					};
				}

				if (this.cost >= this.config.maxCost) {
					logger.warn({ subtaskId: this.subtaskId, cost: this.cost }, 'Max cost reached');
					return {
						result: 'blocked',
						summary: `Reached maximum cost ($${this.config.maxCost})`,
					};
				}

				// Check for completion signals in the session
				const status = await this.checkStatus();
				if (status.completed) {
					return this.buildCompletionResult(status);
				}

				if (status.scopeChangeNeeded) {
					return {
						result: 'scope_change_needed',
						scopeChangeRequest: status.scopeChangeRequest,
						summary: 'Scope change requested',
					};
				}

				// Continue execution - the session handles iteration internally
				this.iterations++;
			}

			return {
				result: 'failed',
				error: 'Session cancelled',
				summary: 'Subtask was cancelled',
			};
		} catch (e) {
			logger.error(e, 'Subtask execution failed');
			return {
				result: 'failed',
				error: e instanceof Error ? e.message : String(e),
				summary: 'Subtask failed with error',
			};
		}
	}

	/**
	 * Cancels the subtask execution
	 */
	cancel(): void {
		this.cancelled = true;
		logger.info({ subtaskId: this.subtaskId }, 'Subtask cancelled');
	}

	/**
	 * Gets the SDK session ID for resumption
	 */
	getSessionId(): string | undefined {
		return this.session?.sessionId;
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Builds the initial prompt for the subtask
	 */
	private buildInitialPrompt(): string {
		const knowledgeBaseStr =
			this.context.knowledgeBase.length > 0
				? this.context.knowledgeBase.map((l) => `- [${l.type}] ${l.content} (${l.category})`).join('\n')
				: 'No specific learnings retrieved.';

		const decisionsStr =
			this.context.decisions.length > 0
				? this.context.decisions
						.slice(-5)
						.map((d) => `- ${d.question}: ${d.chosenOption}`)
						.join('\n')
				: 'No prior decisions.';

		return `
# Subtask: ${this.context.subtaskDescription}

## Parent Task
${this.context.parentTask}

## Milestone
${this.context.milestone.name}: ${this.context.milestone.description}

## Scope
**Expected files**: ${this.context.scope.expectedFiles.join(', ') || 'Not specified'}
**Expected components**: ${this.context.scope.expectedComponents.join(', ') || 'Not specified'}
**Forbidden paths**: ${this.context.scope.forbiddenPaths.join(', ')}

## Code Style & Patterns (from Knowledge Base)
${knowledgeBaseStr}

## Recent Decisions
${decisionsStr}

## Your Task
${this.context.subtaskDescription}

Please start by understanding the current state of the codebase relevant to this subtask, then implement the required changes. Commit your work regularly with clear messages.

When you're done, provide a summary of what you changed and any decisions you made.
`;
	}

	/**
	 * Sends a message to the session and receives the response
	 */
	private async sendMessage(message: string): Promise<void> {
		if (!this.session) return;

		// Send the message
		await this.session.send(message);

		// Receive and process the response
		for await (const event of this.session.receive()) {
			// Process events from the session
			if (event.type === 'result') {
				// Track cost from result message
				const usage = (event as any).usage;
				if (usage) {
					this.cost += (usage.input_tokens ?? 0) * 0.000003 + (usage.output_tokens ?? 0) * 0.000015;
				}
			}
		}
	}

	/**
	 * Checks the status of the subtask
	 */
	private async checkStatus(): Promise<{
		completed: boolean;
		scopeChangeNeeded: boolean;
		scopeChangeRequest?: ScopeChangeRequest;
		summary?: string;
	}> {
		// In a real implementation, this would check for completion markers
		// in the agent's output, tool state, or explicit signals

		// For now, return not completed to continue iteration
		return {
			completed: false,
			scopeChangeNeeded: false,
		};
	}

	/**
	 * Builds the completion result
	 */
	private async buildCompletionResult(status: { summary?: string }): Promise<SubtaskExecutionResult> {
		const git = this.config.git;

		// Get changes made
		const diffStats = await git.getDiffStats(this.baseCommit);
		const diffSummary = await git.getDiffSummary(this.baseCommit);
		const commitLog = await git.getCommitLog(this.baseCommit);

		const changes: BranchChanges = {
			filesChanged: [], // Would be populated from diff
			linesAdded: diffStats.linesAdded,
			linesRemoved: diffStats.linesRemoved,
			commits: commitLog.split('\n').filter((l) => l.trim()),
			diffSummary,
		};

		return {
			result: 'completed',
			changes,
			summary: status.summary ?? 'Subtask completed successfully',
		};
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Creates a new subtask session
 */
export async function createSubtaskSession(
	subtaskId: string,
	parentTaskId: string,
	context: SubtaskContext,
	config: SubtaskSessionConfig,
): Promise<SubtaskSession> {
	const session = new SubtaskSession(subtaskId, parentTaskId, context, config);
	await session.fork();
	return session;
}

/**
 * Resumes an existing subtask session
 */
export async function resumeSubtaskSession(
	subtaskId: string,
	parentTaskId: string,
	context: SubtaskContext,
	config: SubtaskSessionConfig,
	sessionId: string,
): Promise<SubtaskSession> {
	const session = new SubtaskSession(subtaskId, parentTaskId, context, config, sessionId);
	await session.fork();
	return session;
}

// ============================================================================
// Session Factory Implementation
// ============================================================================

/**
 * Factory for creating subtask sessions
 */
export class SubtaskSessionFactory {
	private config: SubtaskSessionConfig;
	private contextCache: Map<string, SubtaskContext> = new Map();

	constructor(config: SubtaskSessionConfig) {
		this.config = config;
	}

	/**
	 * Creates a new subtask session
	 */
	async create(context: SubtaskContext): Promise<SubtaskSession> {
		const subtaskId = `st-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const parentTaskId = 'task-unknown'; // Would be passed in context

		// Cache context for resumption
		this.contextCache.set(subtaskId, context);

		return createSubtaskSession(subtaskId, parentTaskId, context, this.config);
	}

	/**
	 * Resumes an existing session
	 */
	async resume(sessionId: string): Promise<SubtaskSession> {
		// Would need to load context from persistence
		// For now, throw - real implementation would load from disk
		throw new Error(`Cannot resume session ${sessionId}: context not found`);
	}

	/**
	 * Updates config
	 */
	updateConfig(config: Partial<SubtaskSessionConfig>): void {
		Object.assign(this.config, config);
	}
}
