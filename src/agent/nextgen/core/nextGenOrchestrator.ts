/**
 * NextGen Orchestrator
 *
 * Integrates all NextGen components into a unified orchestration layer:
 * - TaskOrchestrator for task/milestone/subtask management
 * - DecisionManager for tiered decision handling
 * - ParallelExplorer for dual worktree exploration
 * - AIReviewer for knowledge-base powered reviews
 * - NotificationService for multi-channel notifications
 */

import { join } from 'node:path';
import { logger } from '#o11y/logger';
import type { LLM } from '#shared/agent/agent.model';
import type { AgentLLMs, LlmFunctions } from '#shared/agent/agent.model';
import type { Session } from '../agentSdk';
import { type DecisionManager, createDecisionManager } from '../decisions/decisionManager';
import { KnowledgeBase } from '../learning/knowledgeBase';
import type { NotificationService } from '../notifications/notificationService';
import { createNotificationService } from '../notifications/notificationService';
import type { BranchChanges, Milestone, SubtaskDefinition, TaskDefinition } from '../orchestrator/milestone';
import { type SubtaskSessionFactory, type TaskOrchestrator, createTaskOrchestrator } from '../orchestrator/taskOrchestrator';
import { createGitWorktreeService } from '../parallel/gitWorktreeService';
import { type ParallelExplorationContext, type ParallelExplorationInput, type ParallelExplorer, createParallelExplorer } from '../parallel/parallelExplorer';
import { type AIReviewer, createAIReviewer } from '../review/aiReviewer';
import { GitBranchingService } from '../subtask/gitBranching';
import { SubtaskSessionFactory as SubtaskSessionFactoryImpl } from '../subtask/subtaskSession';

// ============================================================================
// NextGen Orchestrator Types
// ============================================================================

/**
 * Response from onSubtaskMerged callback
 */
export type SubtaskMergeResponse =
	| 'continue' // Proceed to next subtask
	| 'abort' // Stop task execution
	| { action: 'feedback'; message: string }; // Rerun subtask with feedback

/**
 * Configuration for NextGen Orchestrator
 */
export interface NextGenOrchestratorConfig {
	/** Working directory */
	workingDirectory: string;
	/** LLMs for different task levels */
	llms: AgentLLMs;
	/** Functions available to agents */
	functions: LlmFunctions;
	/** Base path for decisions files */
	decisionsDir?: string;
	/** Base path for knowledge base */
	knowledgeBasePath?: string;
	/** Maximum cost per subtask */
	maxCostPerSubtask?: number;
	/** Maximum iterations per subtask */
	maxIterationsPerSubtask?: number;
	/** Notification configuration */
	notifications?: {
		desktop?: boolean;
		webhook?: { url: string; format: 'slack' | 'discord' | 'generic' };
		websocket?: { broadcast: (msg: string) => void };
	};
	/** Callbacks for human interaction */
	callbacks?: {
		/** Called when human input is needed for major decisions */
		onDecisionRequired?: (question: string, options: string[], context: string) => Promise<string>;
		/** Called when parallel options are ready */
		onParallelOptionsReady?: (taskId: string, options: any[]) => Promise<string>;
		/** Called when human review is needed */
		onReviewRequired?: (taskId: string, subtaskId: string, review: any) => Promise<'approved' | 'changes_requested'>;
		/**
		 * Called after a subtask branch is merged to the feature branch.
		 * Allows human inspection before continuing.
		 * @returns 'continue' to proceed, 'abort' to stop, or { action: 'feedback', message: string } to rerun with feedback
		 */
		onSubtaskMerged?: (taskId: string, subtaskId: string, branchChanges: BranchChanges) => Promise<SubtaskMergeResponse>;
	};
}

/**
 * State of the NextGen orchestrator
 */
export interface NextGenOrchestratorState {
	/** Current task ID */
	taskId?: string;
	/** Current task definition */
	task?: TaskDefinition;
	/** Current milestone index */
	currentMilestoneIndex: number;
	/** Active subtask sessions */
	activeSubtasks: string[];
	/** Pending decisions */
	pendingDecisions: string[];
	/** Pending parallel exploration */
	pendingParallelExploration?: ParallelExplorationContext;
	/** Total cost */
	totalCost: number;
	/** Started at */
	startedAt?: number;
	/** Current active session (for forking during parallel exploration) */
	currentSession?: Session;
}

/**
 * Events emitted by the orchestrator
 */
export type NextGenEvent =
	| { type: 'task_started'; taskId: string }
	| { type: 'milestone_started'; milestoneId: string }
	| { type: 'milestone_completed'; milestoneId: string }
	| { type: 'subtask_started'; subtaskId: string }
	| { type: 'subtask_completed'; subtaskId: string }
	| { type: 'decision_required'; decisionId: string; question: string }
	| { type: 'parallel_started'; options: string[] }
	| { type: 'parallel_ready'; options: any[] }
	| { type: 'review_required'; subtaskId: string }
	| { type: 'task_completed'; taskId: string }
	| { type: 'task_failed'; taskId: string; error: string };

/**
 * Event listener type
 */
export type NextGenEventListener = (event: NextGenEvent) => void;

// ============================================================================
// NextGen Orchestrator Implementation
// ============================================================================

/**
 * Main orchestrator for NextGen agent architecture
 */
export class NextGenOrchestrator {
	private config: NextGenOrchestratorConfig;
	private state: NextGenOrchestratorState;

	// Components
	private taskOrchestrator: TaskOrchestrator | null = null;
	private decisionManager: DecisionManager | null = null;
	private parallelExplorer: ParallelExplorer | null = null;
	private aiReviewer: AIReviewer | null = null;
	private notificationService: NotificationService;
	private knowledgeBase: KnowledgeBase;
	private git: GitBranchingService;

	// Event listeners
	private listeners: NextGenEventListener[] = [];

	constructor(config: NextGenOrchestratorConfig) {
		this.config = {
			decisionsDir: join(config.workingDirectory, '.typedai', 'decisions'),
			knowledgeBasePath: join(config.workingDirectory, '.typedai', 'learnings'),
			maxCostPerSubtask: 5.0,
			maxIterationsPerSubtask: 30,
			...config,
		};

		this.state = {
			currentMilestoneIndex: 0,
			activeSubtasks: [],
			pendingDecisions: [],
			totalCost: 0,
		};

		// Initialize core services
		this.knowledgeBase = new KnowledgeBase({
			basePath: this.config.knowledgeBasePath,
		});

		this.git = new GitBranchingService({
			workingDirectory: this.config.workingDirectory,
		});

		this.notificationService = createNotificationService({
			cli: { enabled: true, useColors: true, useIcons: true },
			desktop: { enabled: config.notifications?.desktop ?? false },
			webhook: config.notifications?.webhook ? { enabled: true, ...config.notifications.webhook } : { enabled: false, url: '', format: 'generic' },
			websocket: config.notifications?.websocket ? { enabled: true, broadcast: config.notifications.websocket.broadcast } : { enabled: false },
		});
	}

	/**
	 * Initializes the orchestrator
	 */
	async initialize(): Promise<void> {
		await this.knowledgeBase.initialize();
		logger.info({ workingDir: this.config.workingDirectory }, 'NextGen Orchestrator initialized');
	}

	/**
	 * Starts a new task
	 */
	async startTask(task: TaskDefinition): Promise<void> {
		logger.info({ taskId: task.id }, 'Starting task');

		this.state.taskId = task.id;
		this.state.task = task;
		this.state.currentMilestoneIndex = 0;
		this.state.startedAt = Date.now();

		// Create session factory for subtasks
		const sessionFactory = new SubtaskSessionFactoryImpl({
			git: this.git,
			workingDirectory: this.config.workingDirectory,
			maxIterations: this.config.maxIterationsPerSubtask!,
			maxCost: this.config.maxCostPerSubtask!,
		});

		// Create task orchestrator
		this.taskOrchestrator = createTaskOrchestrator(this.knowledgeBase, sessionFactory, { decisionsDir: this.config.decisionsDir });

		// Create decision manager
		this.decisionManager = createDecisionManager({
			llm: this.config.llms.medium,
			knowledgeBase: this.knowledgeBase,
			decisionsDir: this.config.decisionsDir!,
			taskId: task.id,
			taskDescription: task.description,
			humanInputCallback: this.config.callbacks?.onDecisionRequired,
			parallelExplorationCallback: async (options) => {
				const result = await this.runParallelExploration(options as any);
				return result;
			},
		});

		// Create AI reviewer
		this.aiReviewer = createAIReviewer({
			llm: this.config.llms.medium,
			knowledgeBase: this.knowledgeBase,
			git: this.git,
			autoApproveThreshold: 0.85,
			maxIssuesBeforeEscalate: 5,
			allowAutoApproval: true,
		});

		// Create parallel explorer
		const worktreeService = createGitWorktreeService({
			repoPath: this.config.workingDirectory,
			taskId: task.id,
		});

		this.parallelExplorer = createParallelExplorer({
			worktreeService,
			llm: this.config.llms.medium,
			maxCostPerOption: this.config.maxCostPerSubtask! / 2,
			maxIterationsPerOption: this.config.maxIterationsPerSubtask! / 2,
			selectionCallback: async (results) => {
				// Notify and wait for human selection
				await this.notificationService.notifyParallelOptionsReady(
					task.id,
					results.map((r) => ({
						id: r.optionId,
						name: r.optionName,
						summary: r.summary ?? 'No summary',
					})),
				);

				if (this.config.callbacks?.onParallelOptionsReady) {
					return this.config.callbacks.onParallelOptionsReady(task.id, results);
				}

				// Default: return first completed option
				const completed = results.find((r) => r.status === 'completed');
				return completed?.optionId ?? results[0].optionId;
			},
		});

		// Start the task
		await this.taskOrchestrator.startTask(task);

		this.emit({ type: 'task_started', taskId: task.id });
		await this.notificationService.notify('task_started', 'Task Started', task.description, { taskId: task.id });

		// Begin processing milestones
		await this.processNextMilestone();
	}

	/**
	 * Resumes an existing task
	 */
	async resumeTask(taskId: string): Promise<void> {
		if (!this.taskOrchestrator) {
			throw new Error('No task orchestrator - call startTask first');
		}

		await this.taskOrchestrator.resumeTask(taskId);
		await this.processNextMilestone();
	}

	/**
	 * Handles a decision response from human
	 */
	async handleDecisionResponse(decisionId: string, chosenOption: string, feedback?: string): Promise<void> {
		if (!this.decisionManager) return;

		await this.decisionManager.updateReviewStatus(decisionId, feedback ? 'overridden' : 'approved', feedback);

		// Continue processing
		await this.processNextMilestone();
	}

	/**
	 * Handles parallel option selection
	 */
	async handleParallelSelection(selectedOptionId: string): Promise<void> {
		// This would be handled by the parallel explorer's selection callback
		logger.info({ selectedOptionId }, 'Parallel option selected');
	}

	/**
	 * Gets the current state
	 */
	getState(): NextGenOrchestratorState {
		return { ...this.state };
	}

	/**
	 * Gets decisions for review
	 */
	getDecisionsForReview(): any[] {
		return this.decisionManager?.getPendingReviewDecisions() ?? [];
	}

	/**
	 * Adds an event listener
	 */
	addEventListener(listener: NextGenEventListener): void {
		this.listeners.push(listener);
	}

	/**
	 * Removes an event listener
	 */
	removeEventListener(listener: NextGenEventListener): void {
		const index = this.listeners.indexOf(listener);
		if (index >= 0) {
			this.listeners.splice(index, 1);
		}
	}

	/**
	 * Cancels the current task
	 */
	async cancel(): Promise<void> {
		logger.info({ taskId: this.state.taskId }, 'Cancelling task');

		if (this.parallelExplorer) {
			await this.parallelExplorer.cancel();
		}

		// Note: TaskOrchestrator doesn't have a cancel method yet
		// The active sessions will be cleaned up when this orchestrator is disposed
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Processes the next milestone
	 */
	private async processNextMilestone(): Promise<void> {
		if (!this.taskOrchestrator || !this.state.task) return;

		const milestone = this.taskOrchestrator.getNextMilestone();
		if (!milestone) {
			// Task complete
			await this.handleTaskComplete();
			return;
		}

		logger.info({ milestoneId: milestone.id, name: milestone.name }, 'Processing milestone');
		this.emit({ type: 'milestone_started', milestoneId: milestone.id });

		// Process subtasks in this milestone
		for (const subtask of milestone.subtasks) {
			const result = await this.processSubtask(subtask, milestone);
			if (result === 'abort') {
				// Stop processing - task was aborted
				return;
			}
		}

		// Mark milestone complete
		this.taskOrchestrator.completeMilestone(milestone.id);
		this.emit({ type: 'milestone_completed', milestoneId: milestone.id });
		await this.notificationService.notify('milestone_completed', 'Milestone Completed', milestone.name, { taskId: this.state.taskId });

		// Process next milestone
		this.state.currentMilestoneIndex++;
		await this.processNextMilestone();
	}

	/**
	 * Processes a single subtask
	 */
	private async processSubtask(subtask: SubtaskDefinition, milestone: Milestone): Promise<'continue' | 'abort'> {
		if (!this.taskOrchestrator) return 'abort';

		logger.info({ subtaskId: subtask.id, description: subtask.description }, 'Processing subtask');
		this.emit({ type: 'subtask_started', subtaskId: subtask.id });
		this.state.activeSubtasks.push(subtask.id);

		try {
			// Spawn and execute subtask session
			const session = await this.taskOrchestrator.spawnSubtask(subtask);

			// Track current session for potential parallel exploration
			// If a decision triggers parallel exploration, we fork from this session
			this.state.currentSession = session.getSession();

			const result = await this.taskOrchestrator.awaitSubtask(session);

			// Update cost
			this.state.totalCost += session.cost;

			if (result.result === 'completed') {
				// Review the subtask
				let reviewPassed = true;
				if (milestone.requiresHumanReview) {
					reviewPassed = await this.reviewSubtask(subtask.id, session);
				}

				if (reviewPassed) {
					// Merge the subtask branch to the feature branch
					const branchChanges = await this.mergeSubtaskBranch(session);

					// Notify and wait for human inspection
					const mergeResponse = await this.handleSubtaskMerged(subtask.id, branchChanges);

					if (mergeResponse === 'abort') {
						logger.info({ subtaskId: subtask.id }, 'Task aborted by user');
						this.emit({ type: 'task_failed', taskId: this.state.taskId!, error: 'Aborted by user' });
						return 'abort';
					}

					if (typeof mergeResponse === 'object' && mergeResponse.action === 'feedback') {
						// Rerun subtask with feedback
						logger.info({ subtaskId: subtask.id, feedback: mergeResponse.message }, 'Rerunning subtask with feedback');
						// TODO: Implement subtask rerun with feedback injection
						// For now, log and continue
					}

					this.emit({ type: 'subtask_completed', subtaskId: subtask.id });
				}
			} else if (result.result === 'scope_change_needed') {
				// Handle scope change
				logger.warn({ subtaskId: subtask.id }, 'Subtask needs scope change');
				// This would need to notify and get approval
			} else {
				logger.error({ subtaskId: subtask.id, result: result.result }, 'Subtask failed');
			}

			return 'continue';
		} finally {
			this.state.activeSubtasks = this.state.activeSubtasks.filter((id) => id !== subtask.id);
			this.state.currentSession = undefined;
		}
	}

	/**
	 * Reviews a completed subtask
	 * @returns true if review passed, false if failed
	 */
	private async reviewSubtask(subtaskId: string, session: any): Promise<boolean> {
		if (!this.aiReviewer) return true;

		logger.info({ subtaskId }, 'Reviewing subtask');
		this.emit({ type: 'review_required', subtaskId });

		const review = await this.aiReviewer.reviewBranch({
			branch: session.branch,
			base: session.baseCommit,
			subtaskDescription: session.context?.subtaskDescription ?? '',
		});

		if (review.decision === 'approved') {
			await this.notificationService.notify('review_complete', 'Review Passed', `Subtask ${subtaskId} approved by AI`, {
				taskId: this.state.taskId,
				subtaskId,
			});
			return true;
		}
		if (review.decision === 'escalate_to_human') {
			await this.notificationService.notifyReviewRequired(this.state.taskId!, subtaskId, review.reasoning);

			if (this.config.callbacks?.onReviewRequired) {
				const humanDecision = await this.config.callbacks.onReviewRequired(this.state.taskId!, subtaskId, review);
				return humanDecision === 'approved';
			}
			// If no callback, default to approved (will be reviewed at merge time)
			return true;
		}

		return false;
	}

	/**
	 * Merges a subtask branch to the feature branch
	 */
	private async mergeSubtaskBranch(session: any): Promise<BranchChanges> {
		const subtaskBranch = session.branch;
		const baseCommit = session.baseCommit;

		logger.info({ subtaskBranch }, 'Merging subtask branch');

		// Get diff stats before merge
		const diffStats = await this.git.getDiffStats(baseCommit);
		const diffSummary = await this.git.getDiffSummary(baseCommit);
		const commitLog = await this.git.getCommitLog(baseCommit);

		// Get the feature branch name (parent branch)
		const featureBranch = await this.git.getCurrentBranch();

		// Merge subtask branch into feature branch
		await this.git.mergeBranch(subtaskBranch, featureBranch);

		const branchChanges: BranchChanges = {
			filesChanged: diffSummary
				.split('\n')
				.filter((line) => line.includes('|'))
				.map((line) => line.split('|')[0].trim()),
			linesAdded: diffStats.linesAdded,
			linesRemoved: diffStats.linesRemoved,
			commits: commitLog.split('\n').filter((l) => l.trim()),
			diffSummary,
		};

		logger.info(
			{
				filesChanged: branchChanges.filesChanged.length,
				linesAdded: branchChanges.linesAdded,
				linesRemoved: branchChanges.linesRemoved,
			},
			'Subtask branch merged',
		);

		return branchChanges;
	}

	/**
	 * Handles the onSubtaskMerged callback, waiting for human response
	 */
	private async handleSubtaskMerged(subtaskId: string, branchChanges: BranchChanges): Promise<SubtaskMergeResponse> {
		// Notify about the merge
		await this.notificationService.notify('subtask_merged', 'Subtask Merged', `Subtask ${subtaskId} merged successfully`, {
			taskId: this.state.taskId,
			subtaskId,
			data: {
				filesChanged: branchChanges.filesChanged.length,
				linesAdded: branchChanges.linesAdded,
				linesRemoved: branchChanges.linesRemoved,
			},
		});

		// If no callback, continue automatically
		if (!this.config.callbacks?.onSubtaskMerged) {
			return 'continue';
		}

		// Wait for human response
		logger.info({ subtaskId }, 'Waiting for human review of merged subtask');
		const response = await this.config.callbacks.onSubtaskMerged(this.state.taskId!, subtaskId, branchChanges);

		logger.info({ subtaskId, response: typeof response === 'string' ? response : response.action }, 'Received human response');
		return response;
	}

	/**
	 * Runs parallel exploration for medium decisions.
	 * Forks the current session so each option inherits the parent's context.
	 */
	private async runParallelExploration(options: any[]): Promise<string> {
		if (!this.parallelExplorer || !this.state.task) {
			throw new Error('Parallel explorer not initialized');
		}

		if (!this.state.currentSession) {
			throw new Error('No current session to fork from');
		}

		this.emit({ type: 'parallel_started', options: options.map((o) => o.id) });

		const context: ParallelExplorationContext = {
			parentTask: this.state.task.description,
			decisionQuestion: this.state.pendingParallelExploration?.decisionQuestion ?? 'Decision',
			baseBranch: await this.git.getCurrentBranch(),
			baseCommit: await this.git.getHeadCommit(),
			knowledgeBase: await this.knowledgeBase.getAllCodeStyleLearnings(),
		};

		// Use the new input format with parentSession for forking
		const input: ParallelExplorationInput = {
			options,
			context,
			parentSession: this.state.currentSession,
		};

		const result = await this.parallelExplorer.explore(input);

		this.emit({ type: 'parallel_ready', options: result.options });

		// Get human selection
		const selectedId = await this.parallelExplorer.getHumanSelection(result.options);

		// Finalize
		await this.parallelExplorer.finalize(result, selectedId, await this.git.getCurrentBranch());

		return selectedId;
	}

	/**
	 * Handles task completion
	 */
	private async handleTaskComplete(): Promise<void> {
		if (!this.state.taskId) return;

		logger.info({ taskId: this.state.taskId, cost: this.state.totalCost }, 'Task completed');
		this.emit({ type: 'task_completed', taskId: this.state.taskId });

		await this.notificationService.notify(
			'task_completed',
			'Task Completed',
			`Task ${this.state.taskId} completed. Total cost: $${this.state.totalCost.toFixed(4)}`,
			{ taskId: this.state.taskId, data: { totalCost: this.state.totalCost } },
		);
	}

	/**
	 * Emits an event
	 */
	private emit(event: NextGenEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (e) {
				logger.error(e, 'Error in event listener');
			}
		}
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a NextGen orchestrator
 */
export function createNextGenOrchestrator(config: NextGenOrchestratorConfig): NextGenOrchestrator {
	return new NextGenOrchestrator(config);
}
