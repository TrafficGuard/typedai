/**
 * Subtask Manager
 *
 * Agent functions for hierarchical subtask management with git branching.
 * Provides functions that the agent can call to:
 * - Start new subtasks (with optional nesting)
 * - Request human review
 * - Query subtask status
 */

import { agentContext } from '#agent/agentContext';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/agent/agent.model';
import { GitBranchingService, createSubtaskBranchName, abortSubtask as gitAbortSubtask, completeSubtask as gitCompleteSubtask } from './gitBranching';
import {
	DEFAULT_SUBTASK_CONFIG,
	type ReviewRound,
	type Subtask,
	type SubtaskConfig,
	type SubtaskContextStatus,
	type SubtaskSummary,
	type SubtaskToolState,
	createEmptySubtaskToolState,
	getCurrentSubtask,
	getParentChain,
	getSubtaskDepth,
} from './subtask.model';

import type { AgentRunningState } from '#shared/agent/agent.model';

/**
 * Agent state for human-in-the-loop review
 */
export const HITL_REVIEW_STATE: AgentRunningState = 'hitl_review';

/**
 * Gets or initializes the subtask tool state
 */
function getSubtaskToolState(agent: AgentContext): SubtaskToolState {
	if (!agent.toolState) {
		agent.toolState = {};
	}
	if (!agent.toolState.subtask) {
		const workingDir = agent.fileSystem?.getWorkingDirectory() ?? process.cwd();
		const git = new GitBranchingService({ workingDirectory: workingDir });
		// Initialize with current branch as base - this will be set properly on first use
		agent.toolState.subtask = createEmptySubtaskToolState('main');
	}
	return agent.toolState.subtask as SubtaskToolState;
}

/**
 * Gets the git branching service
 */
function getGitService(): GitBranchingService {
	const agent = agentContext();
	const workingDir = agent?.fileSystem?.getWorkingDirectory() ?? process.cwd();
	return new GitBranchingService({ workingDirectory: workingDir });
}

@funcClass(__filename)
export class SubtaskManager {
	private config: SubtaskConfig;

	constructor(config: Partial<SubtaskConfig> = {}) {
		this.config = { ...DEFAULT_SUBTASK_CONFIG, ...config };
	}

	/**
	 * Starts a new subtask with a dedicated git branch.
	 * Use this to break down large work into reviewable units.
	 * Each subtask runs on its own branch and requires human review before completion.
	 * Subtasks can be nested - specify parentSubtaskId to create a child subtask.
	 * @param subtaskId A short identifier for the subtask (e.g., "migrate-auth", "fix-login-bug")
	 * @param description Human-readable description of what this subtask will accomplish
	 * @param parentSubtaskId Optional parent subtask ID to nest this subtask under
	 * @returns Confirmation message with branch name and instructions
	 */
	@func()
	async startSubtask(subtaskId: string, description: string, parentSubtaskId?: string): Promise<string> {
		const agent = agentContext();
		if (!agent) throw new Error('No agent context available');

		const toolState = getSubtaskToolState(agent);
		const git = getGitService();

		// Validate subtask ID doesn't already exist
		if (toolState.subtasks[subtaskId]) {
			throw new Error(`Subtask '${subtaskId}' already exists. Choose a different ID.`);
		}

		// Determine base branch
		let baseBranch: string;
		let parentSubtask: Subtask | undefined;

		if (parentSubtaskId) {
			parentSubtask = toolState.subtasks[parentSubtaskId];
			if (!parentSubtask) {
				throw new Error(`Parent subtask '${parentSubtaskId}' not found`);
			}
			if (parentSubtask.status !== 'active') {
				throw new Error(`Parent subtask '${parentSubtaskId}' is not active (status: ${parentSubtask.status})`);
			}
			baseBranch = parentSubtask.branch;
		} else {
			// Initialize base branch on first top-level subtask
			if (toolState.subtaskStack.length === 0) {
				toolState.baseBranch = await git.getCurrentBranch();
			}
			baseBranch = toolState.baseBranch;
		}

		// Create branch name
		const branchName = createSubtaskBranchName(subtaskId, parentSubtaskId ? parentSubtask?.branch : undefined, this.config.branchPrefix);

		// Create the branch
		const baseCommit = await git.createSubtaskBranch(branchName, baseBranch);

		// Create subtask record
		const subtask: Subtask = {
			id: subtaskId,
			description,
			branch: branchName,
			baseCommit,
			parentId: parentSubtaskId,
			childIds: [],
			status: 'active',
			startedAt: Date.now(),
			reviewRounds: [],
		};

		// Update parent's childIds if nested
		if (parentSubtask) {
			parentSubtask.childIds.push(subtaskId);
		}

		// Store subtask and update stack
		toolState.subtasks[subtaskId] = subtask;
		toolState.subtaskStack.push(subtaskId);

		logger.info({ subtaskId, branch: branchName, parentId: parentSubtaskId, baseCommit }, 'Started new subtask');

		const depth = getSubtaskDepth(subtask, toolState);
		const depthIndicator = depth > 0 ? ` (nested ${depth} level${depth > 1 ? 's' : ''} deep)` : '';

		return `Started subtask '${subtaskId}'${depthIndicator}

Branch: ${branchName}
Base commit: ${baseCommit}
Description: ${description}

You are now working on branch '${branchName}'. Make your changes and commit them regularly.
When ready for review, call requestReview() with a summary of your work.`;
	}

	/**
	 * Requests human review of the current subtask.
	 * This pauses the agent and presents the work to a human reviewer.
	 * The reviewer can approve, request changes, or abort the subtask.
	 * All uncommitted changes will be automatically committed before review.
	 * @param summary A summary of the work completed in this subtask
	 * @returns Message indicating the review has been requested
	 */
	@func()
	async requestReview(summary: string): Promise<string> {
		const agent = agentContext();
		if (!agent) throw new Error('No agent context available');

		const toolState = getSubtaskToolState(agent);
		const currentSubtask = getCurrentSubtask(toolState);

		if (!currentSubtask) {
			throw new Error('No active subtask. Start a subtask first with startSubtask().');
		}

		if (currentSubtask.status !== 'active') {
			throw new Error(`Current subtask '${currentSubtask.id}' is not active (status: ${currentSubtask.status})`);
		}

		const git = getGitService();

		// Check for loop detection - too many review rounds
		if (currentSubtask.reviewRounds.length >= this.config.maxReviewRounds) {
			logger.warn({ subtaskId: currentSubtask.id, rounds: currentSubtask.reviewRounds.length }, 'Too many review rounds - possible loop detected');
		}

		// Auto-commit uncommitted changes if configured
		let commitAtRequest: string | undefined;
		if (this.config.autoCommitOnReview) {
			const commitSha = await git.commitAllChanges(`Review request: ${summary.slice(0, 50)}`);
			if (commitSha) {
				commitAtRequest = commitSha;
			}
		}

		// Get current commit
		commitAtRequest = commitAtRequest || (await git.getHeadCommit());

		// Create review round
		const reviewRound: ReviewRound = {
			requestedAt: Date.now(),
			summary,
			commitAtRequest,
		};
		currentSubtask.reviewRounds.push(reviewRound);
		currentSubtask.status = 'review';

		// Set agent state to pause for review
		agent.state = HITL_REVIEW_STATE;

		// Get diff stats for logging
		const diffStats = await git.getDiffStats(currentSubtask.baseCommit);

		logger.info(
			{
				subtaskId: currentSubtask.id,
				reviewRound: currentSubtask.reviewRounds.length,
				diffStats,
			},
			'Review requested for subtask',
		);

		return `Review requested for subtask '${currentSubtask.id}' (round ${currentSubtask.reviewRounds.length})

Summary: ${summary}

The agent is now paused waiting for human review.
Branch: ${currentSubtask.branch}
Changes: ${diffStats.filesChanged} files, +${diffStats.linesAdded}/-${diffStats.linesRemoved} lines

The reviewer will see the full diff and commit history.
Possible outcomes:
- APPROVE: Work will be merged and subtask completed
- REQUEST CHANGES: You will receive feedback and continue working
- ABORT: Subtask will be cancelled and changes discarded`;
	}

	/**
	 * Gets the current subtask status including hierarchy information.
	 * Use this to understand where you are in the subtask tree.
	 * @returns Current subtask context and status information
	 */
	@func()
	async getSubtaskStatus(): Promise<SubtaskContextStatus> {
		const agent = agentContext();
		if (!agent) throw new Error('No agent context available');

		const toolState = getSubtaskToolState(agent);
		const currentSubtask = getCurrentSubtask(toolState);

		// Build summaries for all subtasks
		const allSubtasks: SubtaskSummary[] = Object.values(toolState.subtasks).map((subtask) => ({
			id: subtask.id,
			description: subtask.description,
			status: subtask.status,
			branch: subtask.branch,
			parentId: subtask.parentId,
			childCount: subtask.childIds.length,
			reviewRounds: subtask.reviewRounds.length,
			depth: getSubtaskDepth(subtask, toolState),
		}));

		// Get parent chain for current subtask
		const parentChain = currentSubtask ? getParentChain(currentSubtask, toolState) : [];

		return {
			current: currentSubtask,
			parentChain,
			allSubtasks,
			baseBranch: toolState.baseBranch,
		};
	}

	/**
	 * Lists all subtasks in the current task with their status.
	 * Shows the full hierarchy of subtasks.
	 * @returns Array of subtask summaries with hierarchy information
	 */
	@func()
	async listSubtasks(): Promise<SubtaskSummary[]> {
		const status = await this.getSubtaskStatus();
		return status.allSubtasks;
	}
}

/**
 * Handles the result of a human review decision.
 * Called by the agent runner when resuming from hitl_review state.
 */
export async function handleReviewDecision(
	agent: AgentContext,
	decision: 'approved' | 'changes_requested' | 'aborted',
	feedback?: string,
): Promise<{ continueExecution: boolean; message: string }> {
	const toolState = getSubtaskToolState(agent);
	const currentSubtask = getCurrentSubtask(toolState);

	if (!currentSubtask) {
		throw new Error('No subtask in review state');
	}

	if (currentSubtask.status !== 'review') {
		throw new Error(`Subtask '${currentSubtask.id}' is not in review state (status: ${currentSubtask.status})`);
	}

	const git = getGitService();

	// Update the current review round
	const currentRound = currentSubtask.reviewRounds[currentSubtask.reviewRounds.length - 1];
	if (currentRound) {
		currentRound.decision = decision;
		currentRound.feedback = feedback;
		currentRound.respondedAt = Date.now();
	}

	switch (decision) {
		case 'approved': {
			// Complete the subtask - squash merge to parent
			const finalCommit = await gitCompleteSubtask(git, currentSubtask, toolState);
			currentSubtask.status = 'approved';
			currentSubtask.completedAt = Date.now();
			currentSubtask.finalCommit = finalCommit;

			// Pop from stack
			toolState.subtaskStack.pop();

			// Reset agent state
			agent.state = 'agent';

			logger.info({ subtaskId: currentSubtask.id, finalCommit }, 'Subtask approved and merged');

			return {
				continueExecution: true,
				message: `Subtask '${currentSubtask.id}' approved and merged.\n\nFinal commit: ${finalCommit}\n\nYou can now continue with the next subtask or complete the task.`,
			};
		}

		case 'changes_requested': {
			// Continue working on the subtask
			currentSubtask.status = 'active';
			agent.state = 'agent';

			logger.info({ subtaskId: currentSubtask.id, feedback }, 'Changes requested for subtask');

			return {
				continueExecution: true,
				message: `Changes requested for subtask '${currentSubtask.id}'.\n\nFeedback: ${feedback || 'No specific feedback provided.'}\n\nPlease address the feedback and request review again when ready.`,
			};
		}

		case 'aborted': {
			// Abort the subtask
			await gitAbortSubtask(git, currentSubtask, toolState);
			currentSubtask.status = 'aborted';
			currentSubtask.completedAt = Date.now();

			// Pop from stack
			toolState.subtaskStack.pop();

			// Remove from parent's childIds if nested
			if (currentSubtask.parentId) {
				const parent = toolState.subtasks[currentSubtask.parentId];
				if (parent) {
					parent.childIds = parent.childIds.filter((id) => id !== currentSubtask.id);
				}
			}

			agent.state = 'agent';

			logger.info({ subtaskId: currentSubtask.id, feedback }, 'Subtask aborted');

			return {
				continueExecution: true,
				message: `Subtask '${currentSubtask.id}' aborted.\n\nReason: ${feedback || 'No reason provided.'}\n\nBranch has been deleted and changes discarded.`,
			};
		}
	}
}

/**
 * Gets review information for display to human reviewer
 */
export async function getReviewInfo(agent: AgentContext): Promise<{
	subtask: Subtask;
	diffSummary: string;
	commitLog: string;
	diffStats: { filesChanged: number; linesAdded: number; linesRemoved: number };
	parentChain: Array<{ id: string; description: string }>;
}> {
	const toolState = getSubtaskToolState(agent);
	const currentSubtask = getCurrentSubtask(toolState);

	if (!currentSubtask) {
		throw new Error('No active subtask');
	}

	const git = getGitService();

	const [diffSummary, commitLog, diffStats] = await Promise.all([
		git.getDiffSummary(currentSubtask.baseCommit),
		git.getCommitLog(currentSubtask.baseCommit),
		git.getDiffStats(currentSubtask.baseCommit),
	]);

	const parentChain = getParentChain(currentSubtask, toolState).map((s) => ({
		id: s.id,
		description: s.description,
	}));

	return {
		subtask: currentSubtask,
		diffSummary,
		commitLog,
		diffStats,
		parentChain,
	};
}
