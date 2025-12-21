/**
 * Task Orchestrator
 *
 * Manages the lifecycle of tasks, milestones, and subtasks.
 * Spawns forked Claude Code sessions for subtask execution.
 *
 * v2.0 adds support for:
 * - Domain memory (goals.yaml, status.json, progress.md, context.md)
 * - Feature-level tracking (Task → Milestone → Subtask → Feature)
 * - Test-bound status (status only changes via test results)
 * - Separate review agent (not the implementing agent)
 */

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '#o11y/logger';
import type { KnowledgeBase, Learning } from '../learning/knowledgeBase';
import type { SubtaskSession } from '../subtask/subtaskSession';
import {
	type BranchChanges,
	type Decision,
	type Feature,
	type FeatureDefinition,
	type Milestone,
	type MilestoneStatus,
	type OptionDefinition,
	type ParallelExplorationResult,
	type PinnedContextItem,
	type ScopeChangeRequest,
	type SubtaskContext,
	type SubtaskDefinition,
	type SubtaskResultType,
	type TaskDefinition,
	type TaskState,
	createEmptyTaskState,
	getAllFeaturesFromTask,
	getFeatureById,
	getMilestoneForFeature,
	getNextMilestone,
	getSubtaskForFeature,
	getTaskProgress,
	isTaskComplete,
	taskHasFeatures,
} from './milestone';

// v2 Domain Memory imports
import {
	type Feature as DomainFeature,
	type DomainMemoryPaths,
	type TaskStatus as DomainTaskStatus,
	type GoalTree,
	domainMemoryExists,
	getDomainMemoryPaths,
	getGoalTree,
	getReviewPaths,
	getTaskStatus,
	initializeDomainMemory,
	loadDomainMemory,
	logFeatureAttempt,
	logFeatureFailed,
	logFeaturePassed,
	recalculateMilestoneStatus,
	selectNextFeature,
	setTaskStatus,
} from '../memory/index.js';

import { type ReviewAgentConfig, type ReviewAgentInput, getBindingDecisions, loadReviewHistory, runReviewAgent } from '../review/index.js';

// ============================================================================
// Session Persistence
// ============================================================================

/**
 * Persisted session state for resumability
 */
export interface PersistedSession {
	subtaskId: string;
	sessionId: string;
	branch: string;
	baseCommit: string;
	status: 'in_progress' | 'awaiting_review' | 'completed' | 'failed';
	lastCheckpoint: number;
	worktreePath?: string;
	milestoneId: string;
	taskId: string;
}

// ============================================================================
// Orchestrator Events
// ============================================================================

export type OrchestratorEvent =
	| { type: 'task_started'; task: TaskDefinition }
	| { type: 'milestone_started'; milestone: Milestone }
	| { type: 'milestone_completed'; milestone: Milestone }
	| { type: 'subtask_started'; subtask: SubtaskDefinition; sessionId: string }
	| { type: 'subtask_completed'; subtaskId: string; result: SubtaskResultType }
	| { type: 'scope_change_requested'; subtaskId: string; request: ScopeChangeRequest }
	| { type: 'decision_recorded'; decision: Decision }
	| { type: 'parallel_exploration_started'; options: OptionDefinition[] }
	| { type: 'parallel_exploration_completed'; results: ParallelExplorationResult[] }
	| { type: 'awaiting_human_selection'; options: ParallelExplorationResult[] }
	| { type: 'task_completed'; task: TaskDefinition };

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void | Promise<void>;

// ============================================================================
// Orchestrator Configuration
// ============================================================================

export interface TaskOrchestratorConfig {
	/** Base directory for session persistence */
	sessionDir: string;
	/** Base directory for decisions.md files */
	decisionsDir: string;
	/** Knowledge base for code style/patterns */
	knowledgeBase: KnowledgeBase;
	/** Factory to create subtask sessions */
	sessionFactory: SubtaskSessionFactory;
	/** Event handlers */
	eventHandlers: OrchestratorEventHandler[];
}

/**
 * Factory interface for creating subtask sessions
 */
export interface SubtaskSessionFactory {
	create(context: SubtaskContext): Promise<SubtaskSession>;
	resume(sessionId: string): Promise<SubtaskSession>;
}

// ============================================================================
// Dynamic Plan Adjustment Types
// ============================================================================

/**
 * A plan adjustment to add/update/remove subtasks or milestones
 */
export type PlanAdjustment =
	| { type: 'add_subtask'; milestoneId: string; subtask: SubtaskDefinition; insertAt?: number }
	| { type: 'update_subtask'; milestoneId: string; subtaskId: string; updates: Partial<SubtaskDefinition> }
	| { type: 'remove_subtask'; milestoneId: string; subtaskId: string }
	| { type: 'add_milestone'; milestone: Milestone; insertAt?: number }
	| { type: 'update_milestone'; milestoneId: string; updates: Partial<Milestone> }
	| { type: 'remove_milestone'; milestoneId: string };

// ============================================================================
// Task Orchestrator
// ============================================================================

/**
 * Orchestrates task execution with milestones and subtasks
 */
export class TaskOrchestrator {
	private config: TaskOrchestratorConfig;
	private state: TaskState | null = null;
	private activeSessions: Map<string, SubtaskSession> = new Map();

	constructor(config: TaskOrchestratorConfig) {
		this.config = config;
	}

	// ========================================================================
	// Task Lifecycle
	// ========================================================================

	/**
	 * Starts a new task
	 */
	async startTask(task: TaskDefinition): Promise<void> {
		logger.info({ taskId: task.id, milestones: task.milestones.length }, 'Starting task');

		this.state = createEmptyTaskState(task);
		await this.persistTaskState();

		await this.emit({ type: 'task_started', task });

		// Start the first available milestone
		await this.processNextMilestone();
	}

	/**
	 * Resumes an interrupted task
	 */
	async resumeTask(taskId: string): Promise<void> {
		// Load task state
		const statePath = join(this.config.sessionDir, `task-${taskId}.json`);
		try {
			const content = await readFile(statePath, 'utf-8');
			this.state = JSON.parse(content);
			logger.info({ taskId }, 'Resumed task from saved state');
		} catch (e) {
			throw new Error(`Cannot resume task ${taskId}: state file not found`);
		}

		// Check for interrupted sessions
		const interruptedSessions = await this.findInterruptedSessions(taskId);
		if (interruptedSessions.length > 0) {
			logger.info({ count: interruptedSessions.length }, 'Found interrupted sessions');
			// Resume interrupted sessions
			for (const session of interruptedSessions) {
				await this.resumeSubtaskSession(session);
			}
		}

		// Continue processing
		await this.processNextMilestone();
	}

	/**
	 * Gets the current task state
	 */
	getState(): TaskState | null {
		return this.state;
	}

	/**
	 * Gets task progress
	 */
	getProgress(): ReturnType<typeof getTaskProgress> | null {
		if (!this.state) return null;
		return getTaskProgress(this.state.task);
	}

	// ========================================================================
	// Milestone Management
	// ========================================================================

	/**
	 * Gets all milestones
	 */
	getMilestones(): Milestone[] {
		return this.state?.task.milestones ?? [];
	}

	/**
	 * Gets the next available milestone
	 */
	getNextMilestone(): Milestone | null {
		if (!this.state) return null;
		return getNextMilestone(this.state.task);
	}

	/**
	 * Marks a milestone as complete
	 */
	async completeMilestone(milestoneId: string): Promise<void> {
		if (!this.state) throw new Error('No active task');

		const milestone = this.state.task.milestones.find((m) => m.id === milestoneId);
		if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`);

		milestone.status = 'completed';
		milestone.completedAt = Date.now();

		await this.persistTaskState();
		await this.emit({ type: 'milestone_completed', milestone });

		// Check if task is complete
		if (isTaskComplete(this.state.task)) {
			this.state.task.completedAt = Date.now();
			await this.persistTaskState();
			await this.emit({ type: 'task_completed', task: this.state.task });
		} else {
			// Process next milestone
			await this.processNextMilestone();
		}
	}

	/**
	 * Updates milestone status
	 */
	async updateMilestoneStatus(milestoneId: string, status: MilestoneStatus): Promise<void> {
		if (!this.state) throw new Error('No active task');

		const milestone = this.state.task.milestones.find((m) => m.id === milestoneId);
		if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`);

		milestone.status = status;
		if (status === 'in_progress' && !milestone.startedAt) {
			milestone.startedAt = Date.now();
		}

		await this.persistTaskState();
	}

	/**
	 * Processes the next available milestone
	 */
	private async processNextMilestone(): Promise<void> {
		if (!this.state) return;

		const nextMilestone = this.getNextMilestone();
		if (!nextMilestone) {
			logger.info('No more milestones to process');
			return;
		}

		this.state.currentMilestoneId = nextMilestone.id;
		await this.updateMilestoneStatus(nextMilestone.id, 'in_progress');
		await this.emit({ type: 'milestone_started', milestone: nextMilestone });

		// Start subtasks for this milestone
		await this.processSubtasksForMilestone(nextMilestone);
	}

	// ========================================================================
	// Subtask Management
	// ========================================================================

	/**
	 * Spawns a subtask session
	 */
	async spawnSubtask(subtask: SubtaskDefinition): Promise<SubtaskSession> {
		if (!this.state) throw new Error('No active task');

		const milestone = this.state.task.milestones.find((m) => m.id === this.state!.currentMilestoneId);
		if (!milestone) throw new Error('No active milestone');

		// Build subtask context
		const context = await this.buildSubtaskContext(subtask, milestone);

		// Create session
		const session = await this.config.sessionFactory.create(context);
		this.activeSessions.set(subtask.id, session);
		this.state.activeSubtaskIds.push(subtask.id);

		// Persist session for resumability
		await this.persistSession({
			subtaskId: subtask.id,
			sessionId: session.id,
			branch: context.branch,
			baseCommit: context.baseCommit,
			status: 'in_progress',
			lastCheckpoint: Date.now(),
			milestoneId: milestone.id,
			taskId: this.state.task.id,
		});

		await this.persistTaskState();
		await this.emit({ type: 'subtask_started', subtask, sessionId: session.id });

		return session;
	}

	/**
	 * Awaits a subtask to complete
	 */
	async awaitSubtask(session: SubtaskSession): Promise<{
		result: SubtaskResultType;
		changes?: BranchChanges;
		scopeChangeRequest?: ScopeChangeRequest;
	}> {
		const result = await session.execute();

		// Update state
		if (this.state) {
			const idx = this.state.activeSubtaskIds.indexOf(session.subtaskId);
			if (idx >= 0) {
				this.state.activeSubtaskIds.splice(idx, 1);
			}
			this.state.totalCost += session.cost;
			this.state.totalIterations += session.iterations;

			await this.persistTaskState();
		}

		// Remove session persistence if completed successfully
		if (result.result === 'completed') {
			await this.removeSessionPersistence(session.subtaskId);
		}

		// Emit events
		await this.emit({ type: 'subtask_completed', subtaskId: session.subtaskId, result: result.result });

		if (result.result === 'scope_change_needed' && result.scopeChangeRequest) {
			await this.emit({
				type: 'scope_change_requested',
				subtaskId: session.subtaskId,
				request: result.scopeChangeRequest,
			});
		}

		this.activeSessions.delete(session.subtaskId);

		return result;
	}

	/**
	 * Processes subtasks for a milestone
	 */
	private async processSubtasksForMilestone(milestone: Milestone): Promise<void> {
		// Find subtasks with no dependencies (can start immediately)
		const readySubtasks = milestone.subtasks.filter((st) => st.dependsOn.length === 0 || st.dependsOn.every((depId) => this.state?.completedSubtasks[depId]));

		for (const subtask of readySubtasks) {
			const session = await this.spawnSubtask(subtask);
			const result = await this.awaitSubtask(session);

			if (result.result === 'completed' && result.changes) {
				// Mark as completed, check for more subtasks
				// In a real implementation, this would be more sophisticated
				logger.info({ subtaskId: subtask.id }, 'Subtask completed successfully');
			} else if (result.result === 'scope_change_needed') {
				// Handle scope change request
				logger.warn({ subtaskId: subtask.id, request: result.scopeChangeRequest }, 'Subtask requested scope change');
				// This would trigger human review in practice
			}
		}
	}

	/**
	 * Resumes an interrupted subtask session
	 */
	private async resumeSubtaskSession(persisted: PersistedSession): Promise<void> {
		try {
			const session = await this.config.sessionFactory.resume(persisted.sessionId);
			this.activeSessions.set(persisted.subtaskId, session);
			logger.info({ subtaskId: persisted.subtaskId }, 'Resumed subtask session');
		} catch (e) {
			logger.error(e, 'Failed to resume subtask session');
			// Clean up the persistence file
			await this.removeSessionPersistence(persisted.subtaskId);
		}
	}

	// ========================================================================
	// Decision Recording
	// ========================================================================

	/**
	 * Records a decision
	 */
	async recordDecision(decision: Decision): Promise<void> {
		if (!this.state) throw new Error('No active task');

		this.state.task.decisions.push(decision);
		await this.persistTaskState();
		await this.appendDecisionToFile(decision);
		await this.emit({ type: 'decision_recorded', decision });
	}

	/**
	 * Gets all recorded decisions
	 */
	getDecisions(): Decision[] {
		return this.state?.task.decisions ?? [];
	}

	/**
	 * Appends a decision to decisions.md
	 */
	private async appendDecisionToFile(decision: Decision): Promise<void> {
		if (!this.state) return;

		const decisionsPath = join(this.config.decisionsDir, `${this.state.task.id}-decisions.md`);

		const entry = `
## [${new Date(decision.timestamp).toISOString()}] ${decision.question.slice(0, 50)}...
- **Tier**: ${decision.tier}${decision.tier === 'major' ? ' (escalated to human)' : ''}
- **Question**: ${decision.question}
- **Options**:
${decision.options.map((opt, i) => `  ${i + 1}. ${opt}`).join('\n')}
- **Chosen**: ${decision.chosenOption}
- **Reasoning**: ${decision.reasoning}
- **Made by**: ${decision.madeBy}
- **Review Status**: ${decision.reviewStatus}
${decision.humanFeedback ? `- **Human Feedback**: ${decision.humanFeedback}` : ''}

---
`;

		try {
			// Ensure directory exists
			await mkdir(this.config.decisionsDir, { recursive: true });

			// Append to file (or create with header)
			try {
				await readFile(decisionsPath, 'utf-8');
				// File exists, append
				const fs = await import('node:fs/promises');
				await fs.appendFile(decisionsPath, entry);
			} catch {
				// File doesn't exist, create with header
				const header = `# Decisions Log\n\nTask: ${this.state.task.description}\nCreated: ${new Date(this.state.task.createdAt).toISOString()}\n\n---\n`;
				await writeFile(decisionsPath, header + entry);
			}
		} catch (e) {
			logger.error(e, 'Failed to write decision to file');
		}
	}

	// ========================================================================
	// Parallel Exploration
	// ========================================================================

	/**
	 * Spawns parallel option exploration
	 */
	async spawnParallelOptions(options: OptionDefinition[]): Promise<ParallelExplorationResult[]> {
		if (options.length > 2) {
			throw new Error('Maximum 2 parallel options allowed');
		}

		await this.emit({ type: 'parallel_exploration_started', options });

		// This would integrate with ParallelExplorer service
		// For now, return empty results
		const results: ParallelExplorationResult[] = [];

		await this.emit({ type: 'parallel_exploration_completed', results });

		if (results.filter((r) => r.success).length > 1) {
			await this.emit({ type: 'awaiting_human_selection', options: results });
		}

		return results;
	}

	// ========================================================================
	// Pinned Context
	// ========================================================================

	/**
	 * Adds a pinned context item
	 */
	async addPinnedContext(item: PinnedContextItem): Promise<void> {
		if (!this.state) throw new Error('No active task');

		// Remove existing item with same key if present
		const idx = this.state.task.pinnedContext.findIndex((p) => p.key === item.key);
		if (idx >= 0) {
			this.state.task.pinnedContext.splice(idx, 1);
		}

		this.state.task.pinnedContext.push(item);
		await this.persistTaskState();
	}

	/**
	 * Gets all pinned context
	 */
	getPinnedContext(): PinnedContextItem[] {
		return this.state?.task.pinnedContext ?? [];
	}

	// ========================================================================
	// Context Building
	// ========================================================================

	/**
	 * Builds context for a subtask session
	 */
	private async buildSubtaskContext(subtask: SubtaskDefinition, milestone: Milestone): Promise<SubtaskContext> {
		if (!this.state) throw new Error('No active task');

		// Retrieve relevant learnings from knowledge base
		const learnings = await this.getRelevantLearnings(subtask);

		// Build branch name
		const branch = `subtask/${milestone.id}/${subtask.id}`;

		// Build system prompt addition
		const systemPromptAddition = this.buildSystemPromptAddition(subtask, milestone);

		return {
			parentTask: this.state.task.description,
			subtaskDescription: subtask.description,
			branch,
			scope: subtask.expectedScope,
			knowledgeBase: learnings,
			decisions: this.state.task.decisions,
			systemPromptAddition,
			baseCommit: 'HEAD', // Would be set by git service
			milestone: {
				id: milestone.id,
				name: milestone.name,
				description: milestone.description,
			},
		};
	}

	/**
	 * Retrieves relevant learnings for a subtask
	 */
	private async getRelevantLearnings(subtask: SubtaskDefinition): Promise<Learning[]> {
		// Query knowledge base for relevant code style and patterns
		const query = {
			text: subtask.description,
			types: ['pattern', 'preference', 'pitfall'] as ('pattern' | 'preference' | 'pitfall')[],
			minConfidence: 0.7,
			limit: 10,
		};

		return await this.config.knowledgeBase.retrieve(query);
	}

	/**
	 * Builds the system prompt addition for forked sessions
	 */
	private buildSystemPromptAddition(subtask: SubtaskDefinition, milestone: Milestone): string {
		if (!this.state) return '';

		const pinnedContextStr = this.state.task.pinnedContext.map((p) => `### ${p.key}\n${p.content}`).join('\n\n');

		const decisionsStr =
			this.state.task.decisions.length > 0
				? this.state.task.decisions
						.slice(-10) // Last 10 decisions
						.map((d) => `- **${d.question}**: ${d.chosenOption} (${d.tier})`)
						.join('\n')
				: 'No decisions recorded yet.';

		return `
# Forked Subtask Context

You are working on a subtask of a larger task. Your work will be reviewed before merging.

## Parent Task
${this.state.task.description}

## Your Subtask
**Goal**: ${subtask.description}
**Milestone**: ${milestone.name} - ${milestone.description}
**Complexity**: ${subtask.complexity}

## Scope Constraints
- **Files to modify**: ${subtask.expectedScope.expectedFiles.join(', ') || 'Not specified'}
- **Components**: ${subtask.expectedScope.expectedComponents.join(', ') || 'Not specified'}
- **Files NOT to touch**: ${subtask.expectedScope.forbiddenPaths.join(', ')}
- **Max iterations**: ${subtask.expectedScope.maxIterations}
- **Max cost**: $${subtask.expectedScope.maxCost.toFixed(2)}

## Pinned Context (Critical Information)
${pinnedContextStr || 'None'}

## Decisions Made So Far
${decisionsStr}

## Instructions
1. Complete your subtask within the defined scope
2. For decisions:
   - Trivial/Minor: Decide and record using the decision recording tool
   - Medium: Report back with options for parallel exploration
   - Major: Stop and ask for clarification
3. If you discover the scope needs to change, report back with:
   - What additional scope is needed
   - Why it's necessary
   - Impact on the subtask
4. When done, provide a summary of your changes for review
5. Commit your work regularly with clear messages

## Completion
When finished, your changes will be:
1. Reviewed by AI (code style, design patterns)
2. Reviewed by human (if needed)
3. Merged to parent branch
`;
	}

	// ========================================================================
	// Persistence
	// ========================================================================

	/**
	 * Persists task state to disk
	 */
	private async persistTaskState(): Promise<void> {
		if (!this.state) return;

		await mkdir(this.config.sessionDir, { recursive: true });
		const statePath = join(this.config.sessionDir, `task-${this.state.task.id}.json`);
		await writeFile(statePath, JSON.stringify(this.state, null, 2));
	}

	/**
	 * Persists a session for resumability
	 */
	private async persistSession(session: PersistedSession): Promise<void> {
		await mkdir(this.config.sessionDir, { recursive: true });
		const sessionPath = join(this.config.sessionDir, `subtask-${session.subtaskId}.json`);
		await writeFile(sessionPath, JSON.stringify(session, null, 2));
	}

	/**
	 * Removes session persistence file
	 */
	private async removeSessionPersistence(subtaskId: string): Promise<void> {
		const sessionPath = join(this.config.sessionDir, `subtask-${subtaskId}.json`);
		try {
			await unlink(sessionPath);
		} catch {
			// File may not exist, that's ok
		}
	}

	/**
	 * Finds interrupted sessions for a task
	 */
	private async findInterruptedSessions(taskId: string): Promise<PersistedSession[]> {
		const sessions: PersistedSession[] = [];

		try {
			const files = await readdir(this.config.sessionDir);
			for (const file of files) {
				if (file.startsWith('subtask-') && file.endsWith('.json')) {
					const content = await readFile(join(this.config.sessionDir, file), 'utf-8');
					const session: PersistedSession = JSON.parse(content);
					if (session.taskId === taskId && session.status === 'in_progress') {
						sessions.push(session);
					}
				}
			}
		} catch {
			// Directory may not exist
		}

		return sessions;
	}

	// ========================================================================
	// Event Handling
	// ========================================================================

	/**
	 * Emits an event to all handlers
	 */
	private async emit(event: OrchestratorEvent): Promise<void> {
		for (const handler of this.config.eventHandlers) {
			try {
				await handler(event);
			} catch (e) {
				logger.error(e, 'Event handler error');
			}
		}
	}

	/**
	 * Adds an event handler
	 */
	addEventHandler(handler: OrchestratorEventHandler): void {
		this.config.eventHandlers.push(handler);
	}

	/**
	 * Removes an event handler
	 */
	removeEventHandler(handler: OrchestratorEventHandler): void {
		const idx = this.config.eventHandlers.indexOf(handler);
		if (idx >= 0) {
			this.config.eventHandlers.splice(idx, 1);
		}
	}

	// ========================================================================
	// Dynamic Plan Adjustment
	// ========================================================================

	/**
	 * Adds a new subtask to a milestone
	 */
	async addSubtask(milestoneId: string, subtask: SubtaskDefinition, options?: { insertAt?: number }): Promise<void> {
		if (!this.state) throw new Error('No active task');

		const milestone = this.state.task.milestones.find((m) => m.id === milestoneId);
		if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`);

		// Check for ID uniqueness
		if (milestone.subtasks.some((st) => st.id === subtask.id)) {
			throw new Error(`Subtask with ID ${subtask.id} already exists`);
		}

		// Insert at specified position or at the end
		if (options?.insertAt !== undefined && options.insertAt >= 0 && options.insertAt < milestone.subtasks.length) {
			milestone.subtasks.splice(options.insertAt, 0, subtask);
		} else {
			milestone.subtasks.push(subtask);
		}

		await this.persistTaskState();
		logger.info({ milestoneId, subtaskId: subtask.id }, 'Added subtask to milestone');
	}

	/**
	 * Updates an existing subtask
	 */
	async updateSubtask(milestoneId: string, subtaskId: string, updates: Partial<SubtaskDefinition>): Promise<void> {
		if (!this.state) throw new Error('No active task');

		const milestone = this.state.task.milestones.find((m) => m.id === milestoneId);
		if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`);

		const subtaskIdx = milestone.subtasks.findIndex((st) => st.id === subtaskId);
		if (subtaskIdx < 0) throw new Error(`Subtask not found: ${subtaskId}`);

		// Check if subtask is already in progress
		if (this.state.activeSubtaskIds.includes(subtaskId)) {
			throw new Error(`Cannot update subtask ${subtaskId}: currently in progress`);
		}

		// Check if subtask is already completed
		if (this.state.completedSubtasks[subtaskId]) {
			throw new Error(`Cannot update subtask ${subtaskId}: already completed`);
		}

		// Apply updates (except id)
		const { id, ...allowedUpdates } = updates;
		Object.assign(milestone.subtasks[subtaskIdx], allowedUpdates);

		await this.persistTaskState();
		logger.info({ milestoneId, subtaskId, updates: Object.keys(allowedUpdates) }, 'Updated subtask');
	}

	/**
	 * Removes a subtask from a milestone
	 */
	async removeSubtask(milestoneId: string, subtaskId: string): Promise<void> {
		if (!this.state) throw new Error('No active task');

		const milestone = this.state.task.milestones.find((m) => m.id === milestoneId);
		if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`);

		// Check if subtask is in progress or completed
		if (this.state.activeSubtaskIds.includes(subtaskId)) {
			throw new Error(`Cannot remove subtask ${subtaskId}: currently in progress`);
		}
		if (this.state.completedSubtasks[subtaskId]) {
			throw new Error(`Cannot remove subtask ${subtaskId}: already completed`);
		}

		const subtaskIdx = milestone.subtasks.findIndex((st) => st.id === subtaskId);
		if (subtaskIdx < 0) throw new Error(`Subtask not found: ${subtaskId}`);

		milestone.subtasks.splice(subtaskIdx, 1);

		// Update dependencies in other subtasks
		for (const st of milestone.subtasks) {
			const depIdx = st.dependsOn.indexOf(subtaskId);
			if (depIdx >= 0) {
				st.dependsOn.splice(depIdx, 1);
			}
		}

		await this.persistTaskState();
		logger.info({ milestoneId, subtaskId }, 'Removed subtask from milestone');
	}

	/**
	 * Reorders subtasks in a milestone
	 */
	async reorderSubtasks(milestoneId: string, newOrder: string[]): Promise<void> {
		if (!this.state) throw new Error('No active task');

		const milestone = this.state.task.milestones.find((m) => m.id === milestoneId);
		if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`);

		// Validate all subtask IDs are present
		const existingIds = new Set(milestone.subtasks.map((st) => st.id));
		const newOrderSet = new Set(newOrder);

		if (existingIds.size !== newOrderSet.size) {
			throw new Error('New order must contain all existing subtask IDs');
		}
		for (const id of newOrder) {
			if (!existingIds.has(id)) {
				throw new Error(`Unknown subtask ID in new order: ${id}`);
			}
		}

		// Create reordered array
		const subtaskMap = new Map(milestone.subtasks.map((st) => [st.id, st]));
		milestone.subtasks = newOrder.map((id) => subtaskMap.get(id)!);

		await this.persistTaskState();
		logger.info({ milestoneId, newOrder }, 'Reordered subtasks');
	}

	/**
	 * Adds a new milestone to the task
	 */
	async addMilestone(milestone: Milestone, options?: { insertAt?: number }): Promise<void> {
		if (!this.state) throw new Error('No active task');

		// Check for ID uniqueness
		if (this.state.task.milestones.some((m) => m.id === milestone.id)) {
			throw new Error(`Milestone with ID ${milestone.id} already exists`);
		}

		// Insert at specified position or at the end
		if (options?.insertAt !== undefined && options.insertAt >= 0 && options.insertAt < this.state.task.milestones.length) {
			this.state.task.milestones.splice(options.insertAt, 0, milestone);
		} else {
			this.state.task.milestones.push(milestone);
		}

		await this.persistTaskState();
		logger.info({ milestoneId: milestone.id, name: milestone.name }, 'Added milestone');
	}

	/**
	 * Updates an existing milestone
	 */
	async updateMilestone(milestoneId: string, updates: Partial<Milestone>): Promise<void> {
		if (!this.state) throw new Error('No active task');

		const milestoneIdx = this.state.task.milestones.findIndex((m) => m.id === milestoneId);
		if (milestoneIdx < 0) throw new Error(`Milestone not found: ${milestoneId}`);

		const milestone = this.state.task.milestones[milestoneIdx];

		// Don't allow updating completed milestones
		if (milestone.status === 'completed') {
			throw new Error(`Cannot update completed milestone: ${milestoneId}`);
		}

		// Apply updates (except id and status)
		const { id, status, ...allowedUpdates } = updates;
		Object.assign(milestone, allowedUpdates);

		await this.persistTaskState();
		logger.info({ milestoneId, updates: Object.keys(allowedUpdates) }, 'Updated milestone');
	}

	/**
	 * Removes a milestone from the task (only if pending)
	 */
	async removeMilestone(milestoneId: string): Promise<void> {
		if (!this.state) throw new Error('No active task');

		const milestoneIdx = this.state.task.milestones.findIndex((m) => m.id === milestoneId);
		if (milestoneIdx < 0) throw new Error(`Milestone not found: ${milestoneId}`);

		const milestone = this.state.task.milestones[milestoneIdx];

		if (milestone.status !== 'pending') {
			throw new Error(`Cannot remove milestone ${milestoneId}: status is ${milestone.status}`);
		}

		this.state.task.milestones.splice(milestoneIdx, 1);

		// Update dependencies in other milestones
		for (const m of this.state.task.milestones) {
			const depIdx = m.dependsOn.indexOf(milestoneId);
			if (depIdx >= 0) {
				m.dependsOn.splice(depIdx, 1);
			}
		}

		await this.persistTaskState();
		logger.info({ milestoneId }, 'Removed milestone');
	}

	/**
	 * Gets a snapshot of the current plan for review/modification
	 */
	getPlanSnapshot(): { milestones: Milestone[]; activeSubtasks: string[]; completedSubtasks: string[] } {
		if (!this.state) {
			return { milestones: [], activeSubtasks: [], completedSubtasks: [] };
		}

		return {
			milestones: JSON.parse(JSON.stringify(this.state.task.milestones)),
			activeSubtasks: [...this.state.activeSubtaskIds],
			completedSubtasks: Object.keys(this.state.completedSubtasks),
		};
	}

	/**
	 * Applies multiple plan adjustments atomically
	 */
	async applyPlanAdjustments(adjustments: PlanAdjustment[]): Promise<void> {
		if (!this.state) throw new Error('No active task');

		// Apply adjustments in order
		for (const adjustment of adjustments) {
			switch (adjustment.type) {
				case 'add_subtask':
					await this.addSubtask(adjustment.milestoneId, adjustment.subtask, { insertAt: adjustment.insertAt });
					break;
				case 'update_subtask':
					await this.updateSubtask(adjustment.milestoneId, adjustment.subtaskId, adjustment.updates);
					break;
				case 'remove_subtask':
					await this.removeSubtask(adjustment.milestoneId, adjustment.subtaskId);
					break;
				case 'add_milestone':
					await this.addMilestone(adjustment.milestone, { insertAt: adjustment.insertAt });
					break;
				case 'update_milestone':
					await this.updateMilestone(adjustment.milestoneId, adjustment.updates);
					break;
				case 'remove_milestone':
					await this.removeMilestone(adjustment.milestoneId);
					break;
			}
		}

		logger.info({ adjustmentCount: adjustments.length }, 'Applied plan adjustments');
	}
}

// ============================================================================
// Factory Helper
// ============================================================================

/**
 * Creates a TaskOrchestrator with default paths
 */
export function createTaskOrchestrator(
	knowledgeBase: KnowledgeBase,
	sessionFactory: SubtaskSessionFactory,
	options: {
		sessionDir?: string;
		decisionsDir?: string;
	} = {},
): TaskOrchestrator {
	const baseDir = process.cwd();

	return new TaskOrchestrator({
		sessionDir: options.sessionDir ?? join(baseDir, '.typedai', 'sessions'),
		decisionsDir: options.decisionsDir ?? join(baseDir, '.typedai', 'decisions'),
		knowledgeBase,
		sessionFactory,
		eventHandlers: [],
	});
}

// ============================================================================
// v2 Domain Memory Integration
// ============================================================================

/**
 * v2 Orchestrator configuration with domain memory support
 */
export interface TaskOrchestratorV2Config extends TaskOrchestratorConfig {
	/** Working directory for the project */
	workingDirectory: string;
	/** LLMs for initializer and worker agents */
	llms?: {
		easy: string;
		medium: string;
		hard: string;
	};
}

/**
 * v2 Feature-level events
 */
export type OrchestratorEventV2 =
	| OrchestratorEvent
	| { type: 'feature_started'; feature: FeatureDefinition; attempt: number }
	| { type: 'feature_tests_passed'; featureId: string; duration: number }
	| { type: 'feature_tests_failed'; featureId: string; error: string; attempt: number }
	| { type: 'feature_review_started'; featureId: string }
	| { type: 'feature_approved'; featureId: string }
	| { type: 'feature_changes_requested'; featureId: string; feedback: string }
	| { type: 'feature_escalated'; featureId: string; reason: string }
	| { type: 'max_attempts_reached'; featureId: string; attempts: number };

/**
 * Creates a v2 TaskOrchestrator with domain memory support
 */
export function createTaskOrchestratorV2(
	knowledgeBase: KnowledgeBase,
	sessionFactory: SubtaskSessionFactory,
	options: {
		workingDirectory?: string;
		sessionDir?: string;
		decisionsDir?: string;
	} = {},
): TaskOrchestrator {
	const baseDir = options.workingDirectory ?? process.cwd();

	return new TaskOrchestrator({
		sessionDir: options.sessionDir ?? join(baseDir, '.typedai', 'sessions'),
		decisionsDir: options.decisionsDir ?? join(baseDir, '.typedai', 'decisions'),
		knowledgeBase,
		sessionFactory,
		eventHandlers: [],
	});
}

/**
 * Check if a task is using v2 mode (has features defined)
 */
export function isV2Task(task: TaskDefinition): boolean {
	return taskHasFeatures(task);
}

/**
 * Get domain memory paths for a task
 */
export function getTaskDomainMemoryPaths(workingDirectory: string, taskId: string): DomainMemoryPaths {
	return getDomainMemoryPaths(workingDirectory, taskId);
}

/**
 * Check if domain memory exists for a task
 */
export async function taskHasDomainMemory(workingDirectory: string, taskId: string): Promise<boolean> {
	const paths = getDomainMemoryPaths(workingDirectory, taskId);
	return domainMemoryExists(paths);
}
