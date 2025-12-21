/**
 * Git Branching Service for Subtasks
 *
 * Handles git operations specific to subtask workflow:
 * - Creating subtask branches
 * - Tracking commits
 * - Squash merging on approval
 * - Diff generation for review
 * - Worktree awareness for parallel exploration
 */

import { logger } from '#o11y/logger';
import { arg, execCommand, failOnError } from '#utils/exec';
import type { Subtask, SubtaskToolState } from './subtask.model';

/**
 * Options for git operations
 */
export interface GitOptions {
	workingDirectory: string;
}

/**
 * Diff statistics
 */
export interface DiffStats {
	filesChanged: number;
	linesAdded: number;
	linesRemoved: number;
}

/**
 * Git branching service for subtask management
 */
export class GitBranchingService {
	constructor(private opts: GitOptions) {}

	/**
	 * Gets the current branch name
	 */
	async getCurrentBranch(): Promise<string> {
		const result = await execCommand('git rev-parse --abbrev-ref HEAD', this.opts);
		failOnError('Failed to get current branch', result);
		return result.stdout.trim();
	}

	/**
	 * Gets the current HEAD commit SHA
	 */
	async getHeadCommit(): Promise<string> {
		const result = await execCommand('git rev-parse HEAD', this.opts);
		failOnError('Failed to get HEAD commit', result);
		return result.stdout.trim();
	}

	/**
	 * Creates a new branch for a subtask
	 */
	async createSubtaskBranch(branchName: string, baseBranch?: string): Promise<string> {
		// If baseBranch is specified, checkout that first
		if (baseBranch) {
			const checkoutResult = await execCommand(`git checkout ${arg(baseBranch)}`, this.opts);
			failOnError(`Failed to checkout base branch ${baseBranch}`, checkoutResult);
		}

		// Record the base commit
		const baseCommit = await this.getHeadCommit();

		// Create and checkout new branch
		const createResult = await execCommand(`git checkout -b ${arg(branchName)}`, this.opts);
		failOnError(`Failed to create branch ${branchName}`, createResult);

		logger.info({ branch: branchName, baseCommit }, 'Created subtask branch');
		return baseCommit;
	}

	/**
	 * Checks if there are uncommitted changes
	 */
	async hasUncommittedChanges(): Promise<boolean> {
		const result = await execCommand('git status --porcelain', this.opts);
		failOnError('Failed to check git status', result);
		return result.stdout.trim().length > 0;
	}

	/**
	 * Commits all uncommitted changes
	 */
	async commitAllChanges(message: string): Promise<string | null> {
		const hasChanges = await this.hasUncommittedChanges();
		if (!hasChanges) {
			return null;
		}

		// Stage all changes
		const addResult = await execCommand('git add -A', this.opts);
		failOnError('Failed to stage changes', addResult);

		// Commit
		const commitResult = await execCommand(`git commit -m ${arg(message)}`, this.opts);
		failOnError('Failed to commit changes', commitResult);

		return await this.getHeadCommit();
	}

	/**
	 * Gets diff statistics between two commits
	 */
	async getDiffStats(baseCommit: string, headCommit?: string): Promise<DiffStats> {
		const head = headCommit || 'HEAD';
		const result = await execCommand(`git diff --shortstat ${baseCommit}..${head}`, this.opts);
		failOnError('Failed to get diff stats', result);

		const output = result.stdout.trim();
		if (!output) {
			return { filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
		}

		// Parse output like: "3 files changed, 45 insertions(+), 10 deletions(-)"
		const filesMatch = output.match(/(\d+) files? changed/);
		const insertionsMatch = output.match(/(\d+) insertions?\(\+\)/);
		const deletionsMatch = output.match(/(\d+) deletions?\(-\)/);

		return {
			filesChanged: filesMatch ? Number.parseInt(filesMatch[1], 10) : 0,
			linesAdded: insertionsMatch ? Number.parseInt(insertionsMatch[1], 10) : 0,
			linesRemoved: deletionsMatch ? Number.parseInt(deletionsMatch[1], 10) : 0,
		};
	}

	/**
	 * Gets the full diff between two commits
	 */
	async getDiff(baseCommit: string, headCommit?: string): Promise<string> {
		const head = headCommit || 'HEAD';
		const result = await execCommand(`git --no-pager diff ${baseCommit}..${head}`, this.opts);
		failOnError('Failed to get diff', result);
		return result.stdout;
	}

	/**
	 * Gets the diff summary (--stat output)
	 */
	async getDiffSummary(baseCommit: string, headCommit?: string): Promise<string> {
		const head = headCommit || 'HEAD';
		const result = await execCommand(`git --no-pager diff --stat ${baseCommit}..${head}`, this.opts);
		failOnError('Failed to get diff summary', result);
		return result.stdout;
	}

	/**
	 * Gets the number of commits between two points
	 */
	async getCommitCount(baseCommit: string, headCommit?: string): Promise<number> {
		const head = headCommit || 'HEAD';
		const result = await execCommand(`git rev-list --count ${baseCommit}..${head}`, this.opts);
		failOnError('Failed to count commits', result);
		return Number.parseInt(result.stdout.trim(), 10);
	}

	/**
	 * Gets commit log between two points
	 */
	async getCommitLog(baseCommit: string, headCommit?: string): Promise<string> {
		const head = headCommit || 'HEAD';
		const result = await execCommand(`git log --oneline ${baseCommit}..${head}`, this.opts);
		failOnError('Failed to get commit log', result);
		return result.stdout;
	}

	/**
	 * Switches to a branch
	 */
	async checkoutBranch(branchName: string): Promise<void> {
		const result = await execCommand(`git checkout ${arg(branchName)}`, this.opts);
		failOnError(`Failed to checkout branch ${branchName}`, result);
	}

	/**
	 * Squash merges a branch into the current branch
	 */
	async squashMerge(sourceBranch: string, commitMessage: string): Promise<string> {
		// Perform squash merge
		const mergeResult = await execCommand(`git merge --squash ${arg(sourceBranch)}`, this.opts);
		failOnError(`Failed to squash merge ${sourceBranch}`, mergeResult);

		// Commit the squashed changes
		const commitResult = await execCommand(`git commit -m ${arg(commitMessage)}`, this.opts);
		failOnError('Failed to commit squash merge', commitResult);

		return await this.getHeadCommit();
	}

	/**
	 * Merges a source branch into a target branch (with squash)
	 * Checks out target, squash merges source, returns the merge commit
	 */
	async mergeBranch(sourceBranch: string, targetBranch: string, squash = true): Promise<string> {
		// Checkout target branch
		await this.checkoutBranch(targetBranch);

		if (squash) {
			// Squash merge
			const mergeResult = await execCommand(`git merge --squash ${arg(sourceBranch)}`, this.opts);
			failOnError(`Failed to squash merge ${sourceBranch} into ${targetBranch}`, mergeResult);

			// Commit the squashed changes
			const commitResult = await execCommand(`git commit -m ${arg(`Merge subtask branch ${sourceBranch}`)}`, this.opts);
			failOnError('Failed to commit squash merge', commitResult);
		} else {
			// Regular merge
			const mergeResult = await execCommand(`git merge ${arg(sourceBranch)} --no-ff -m ${arg(`Merge subtask branch ${sourceBranch}`)}`, this.opts);
			failOnError(`Failed to merge ${sourceBranch} into ${targetBranch}`, mergeResult);
		}

		const mergeCommit = await this.getHeadCommit();
		logger.info({ sourceBranch, targetBranch, mergeCommit, squash }, 'Branch merged');
		return mergeCommit;
	}

	/**
	 * Deletes a branch (local only)
	 */
	async deleteBranch(branchName: string, force = false): Promise<void> {
		const flag = force ? '-D' : '-d';
		const result = await execCommand(`git branch ${flag} ${arg(branchName)}`, this.opts);
		failOnError(`Failed to delete branch ${branchName}`, result);
	}

	/**
	 * Checks if a branch exists
	 */
	async branchExists(branchName: string): Promise<boolean> {
		const result = await execCommand(`git rev-parse --verify ${arg(branchName)}`, this.opts);
		return result.exitCode === 0;
	}

	/**
	 * Aborts any in-progress merge
	 */
	async abortMerge(): Promise<void> {
		const result = await execCommand('git merge --abort', this.opts);
		// Ignore errors - may not be in merge state
		if (result.exitCode !== 0) {
			logger.debug('No merge to abort or abort failed');
		}
	}

	/**
	 * Hard resets to a commit
	 */
	async hardReset(commit: string): Promise<void> {
		const result = await execCommand(`git reset --hard ${arg(commit)}`, this.opts);
		failOnError(`Failed to reset to ${commit}`, result);
	}

	// ========================================================================
	// Worktree-Aware Methods
	// ========================================================================

	/**
	 * Checks if the working directory is a git worktree (not the main repo)
	 */
	async isWorktree(): Promise<boolean> {
		const result = await execCommand('git rev-parse --git-common-dir', this.opts);
		if (result.exitCode !== 0) {
			return false;
		}
		const commonDir = result.stdout.trim();

		const gitDirResult = await execCommand('git rev-parse --git-dir', this.opts);
		if (gitDirResult.exitCode !== 0) {
			return false;
		}
		const gitDir = gitDirResult.stdout.trim();

		// If git-dir and git-common-dir differ, this is a worktree
		return gitDir !== commonDir && gitDir !== '.git';
	}

	/**
	 * Gets the main repository path if in a worktree
	 */
	async getMainRepoPath(): Promise<string | null> {
		const isWt = await this.isWorktree();
		if (!isWt) {
			return null;
		}

		const result = await execCommand('git rev-parse --git-common-dir', this.opts);
		if (result.exitCode !== 0) {
			return null;
		}

		// git-common-dir returns path to .git in main repo
		const commonDir = result.stdout.trim();
		// Remove trailing /.git if present
		return commonDir.replace(/\/\.git\/?$/, '');
	}

	/**
	 * Gets the current worktree path (if in a worktree)
	 */
	async getWorktreePath(): Promise<string | null> {
		const isWt = await this.isWorktree();
		if (!isWt) {
			return null;
		}

		const result = await execCommand('git rev-parse --show-toplevel', this.opts);
		if (result.exitCode !== 0) {
			return null;
		}

		return result.stdout.trim();
	}

	/**
	 * Lists all worktrees (from any worktree or main repo)
	 */
	async listWorktrees(): Promise<WorktreeInfo[]> {
		const result = await execCommand('git worktree list --porcelain', this.opts);
		failOnError('Failed to list worktrees', result);

		return parseWorktreeListOutput(result.stdout);
	}

	/**
	 * Creates a worktree with a new branch
	 */
	async createWorktree(path: string, branch: string, base?: string): Promise<void> {
		const baseRef = base ?? 'HEAD';
		const result = await execCommand(`git worktree add -b ${arg(branch)} ${arg(path)} ${arg(baseRef)}`, this.opts);
		failOnError(`Failed to create worktree at ${path}`, result);
		logger.info({ path, branch, base: baseRef }, 'Created worktree');
	}

	/**
	 * Removes a worktree
	 */
	async removeWorktree(path: string, force = false): Promise<void> {
		const forceFlag = force ? ' --force' : '';
		const result = await execCommand(`git worktree remove${forceFlag} ${arg(path)}`, this.opts);
		failOnError(`Failed to remove worktree at ${path}`, result);
		logger.info({ path }, 'Removed worktree');
	}

	/**
	 * Prunes stale worktree references
	 */
	async pruneWorktrees(): Promise<void> {
		const result = await execCommand('git worktree prune', this.opts);
		failOnError('Failed to prune worktrees', result);
	}
}

/**
 * Information about a git worktree
 */
export interface WorktreeInfo {
	path: string;
	head: string;
	branch?: string;
	bare: boolean;
	detached: boolean;
}

/**
 * Parses git worktree list --porcelain output
 */
function parseWorktreeListOutput(output: string): WorktreeInfo[] {
	const worktrees: WorktreeInfo[] = [];
	const lines = output.trim().split('\n');
	let current: Partial<WorktreeInfo> = {};

	for (const line of lines) {
		if (line === '') {
			if (current.path) {
				worktrees.push({
					path: current.path,
					head: current.head ?? '',
					branch: current.branch,
					bare: current.bare ?? false,
					detached: current.detached ?? false,
				});
			}
			current = {};
			continue;
		}

		if (line.startsWith('worktree ')) {
			current.path = line.slice(9);
		} else if (line.startsWith('HEAD ')) {
			current.head = line.slice(5);
		} else if (line.startsWith('branch ')) {
			current.branch = line.slice(7);
		} else if (line === 'bare') {
			current.bare = true;
		} else if (line === 'detached') {
			current.detached = true;
		}
	}

	// Handle last entry
	if (current.path) {
		worktrees.push({
			path: current.path,
			head: current.head ?? '',
			branch: current.branch,
			bare: current.bare ?? false,
			detached: current.detached ?? false,
		});
	}

	return worktrees;
}

/**
 * Creates a subtask branch name from subtask ID and optional parent
 */
export function createSubtaskBranchName(subtaskId: string, parentBranch?: string, prefix = 'subtask'): string {
	if (parentBranch?.startsWith(`${prefix}/`)) {
		// Nested: subtask/parent/child
		return `${parentBranch}/${subtaskId}`;
	}
	// Top-level: subtask/id
	return `${prefix}/${subtaskId}`;
}

/**
 * Extracts subtask ID from branch name
 */
export function extractSubtaskId(branchName: string, prefix = 'subtask'): string | null {
	if (!branchName.startsWith(`${prefix}/`)) {
		return null;
	}
	const parts = branchName.slice(prefix.length + 1).split('/');
	return parts[parts.length - 1];
}

/**
 * Completes a subtask by squash merging to parent branch
 */
export async function completeSubtask(git: GitBranchingService, subtask: Subtask, toolState: SubtaskToolState): Promise<string> {
	const currentBranch = await git.getCurrentBranch();

	if (currentBranch !== subtask.branch) {
		throw new Error(`Not on subtask branch. Expected ${subtask.branch}, got ${currentBranch}`);
	}

	// Commit any uncommitted changes
	await git.commitAllChanges(`WIP: Final changes for ${subtask.description}`);

	// Determine target branch (parent subtask branch or base branch)
	let targetBranch: string;
	if (subtask.parentId) {
		const parentSubtask = toolState.subtasks[subtask.parentId];
		if (!parentSubtask) {
			throw new Error(`Parent subtask ${subtask.parentId} not found`);
		}
		targetBranch = parentSubtask.branch;
	} else {
		targetBranch = toolState.baseBranch;
	}

	// Checkout target branch
	await git.checkoutBranch(targetBranch);

	// Squash merge
	const commitMessage = `${subtask.description}\n\nSubtask: ${subtask.id}\nReview rounds: ${subtask.reviewRounds.length}`;
	const finalCommit = await git.squashMerge(subtask.branch, commitMessage);

	// Delete the subtask branch
	await git.deleteBranch(subtask.branch, true);

	logger.info({ subtaskId: subtask.id, targetBranch, finalCommit }, 'Subtask completed and merged');

	return finalCommit;
}

/**
 * Aborts a subtask by returning to parent branch and deleting subtask branch
 */
export async function abortSubtask(git: GitBranchingService, subtask: Subtask, toolState: SubtaskToolState): Promise<void> {
	// Determine target branch
	let targetBranch: string;
	if (subtask.parentId) {
		const parentSubtask = toolState.subtasks[subtask.parentId];
		if (!parentSubtask) {
			throw new Error(`Parent subtask ${subtask.parentId} not found`);
		}
		targetBranch = parentSubtask.branch;
	} else {
		targetBranch = toolState.baseBranch;
	}

	// Abort any in-progress operations
	await git.abortMerge();

	// Checkout target branch
	await git.checkoutBranch(targetBranch);

	// Delete the subtask branch
	await git.deleteBranch(subtask.branch, true);

	logger.info({ subtaskId: subtask.id, targetBranch }, 'Subtask aborted');
}
