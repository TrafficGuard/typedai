/**
 * Parallel Exploration Module
 *
 * Exports for git worktree-based parallel option exploration.
 */

// Git Worktree Service
export {
	GitWorktreeService,
	createGitWorktreeService,
	type GitWorktreeServiceConfig,
	type CreateWorktreeOptions,
	type Worktree,
	type GitWorktreeInfo,
	type WorktreeDiffStats,
} from './gitWorktreeService';

// Parallel Explorer
export {
	ParallelExplorer,
	createParallelExplorer,
	type ParallelExplorerConfig,
	type ParallelExplorationInput,
	type ParallelExplorationContext,
	type ParallelExplorationResult,
	type OptionExplorationResult,
	type OptionExplorationStatus,
	type SelectionCallback,
	type StatusCallback,
} from './parallelExplorer';
