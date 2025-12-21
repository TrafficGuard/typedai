/**
 * Parallel Explorer
 *
 * Manages parallel implementation of options using git worktrees.
 * When a medium decision has no clear winner, both options are
 * implemented simultaneously for human selection.
 */

import { logger } from '#o11y/logger';
import type { LLM } from '#shared/agent/agent.model';
import type { Session } from '../agentSdk';
import type { Learning } from '../learning/knowledgeBase';
import { logParallelExplorationComplete, logParallelExplorationStarted } from '../memory/progress.js';
import { runFeatureTest } from '../memory/testRunner.js';
import type { DomainMemoryPaths, Feature, TestResult } from '../memory/types.js';
import type { OptionDefinition, SubtaskContext } from '../orchestrator/milestone';
import { type GitWorktreeService, type Worktree, type WorktreeDiffStats } from './gitWorktreeService';

// ============================================================================
// Parallel Exploration Types
// ============================================================================

/**
 * Status of an option exploration
 */
export type OptionExplorationStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Result from exploring a single option
 */
export interface OptionExplorationResult {
	/** Option ID */
	optionId: string;
	/** Option name */
	optionName: string;
	/** Exploration status */
	status: OptionExplorationStatus;
	/** Worktree used */
	worktree: Worktree;
	/** Diff statistics */
	diffStats?: WorktreeDiffStats;
	/** Summary of changes */
	summary?: string;
	/** Commit log */
	commits?: string;
	/** Error if failed */
	error?: string;
	/** Cost incurred */
	cost: number;
	/** Time taken (ms) */
	duration: number;
}

/**
 * Result from parallel exploration
 */
export interface ParallelExplorationResult {
	/** All option results */
	options: OptionExplorationResult[];
	/** Whether exploration is complete */
	complete: boolean;
	/** Total cost */
	totalCost: number;
	/** Total duration (max of individual durations) */
	totalDuration: number;
}

/**
 * Callback when human needs to select an option
 */
export type SelectionCallback = (results: OptionExplorationResult[]) => Promise<string>;

/**
 * Callback for status updates during exploration
 */
export type StatusCallback = (optionId: string, status: OptionExplorationStatus, message?: string) => void;

/**
 * Configuration for parallel explorer
 */
export interface ParallelExplorerConfig {
	/** Git worktree service */
	worktreeService: GitWorktreeService;
	/** LLM for sessions */
	llm: LLM;
	/** Maximum cost per option */
	maxCostPerOption: number;
	/** Maximum iterations per option */
	maxIterationsPerOption: number;
	/** Callback for human selection */
	selectionCallback?: SelectionCallback;
	/** Callback for status updates */
	statusCallback?: StatusCallback;
}

/**
 * Input for starting a parallel exploration
 */
export interface ParallelExplorationInput {
	/** Options to explore */
	options: OptionDefinition[];
	/** Exploration context */
	context: ParallelExplorationContext;
	/** Parent session to fork from - forked sessions inherit parent context */
	parentSession: Session;
}

// ============================================================================
// Parallel Explorer Implementation
// ============================================================================

/**
 * Manages parallel exploration of options in worktrees
 */
export class ParallelExplorer {
	private config: ParallelExplorerConfig;
	private activeExplorations: Map<string, OptionExploration> = new Map();

	constructor(config: ParallelExplorerConfig) {
		this.config = config;
	}

	/**
	 * Explores multiple options in parallel using worktrees.
	 * Each option is explored in a forked session that inherits the parent's context.
	 */
	async explore(input: ParallelExplorationInput): Promise<ParallelExplorationResult> {
		const { options, context, parentSession } = input;

		if (options.length < 2) {
			throw new Error('Parallel exploration requires at least 2 options');
		}

		// Limit to 2 options as per design
		const optionsToExplore = options.slice(0, 2);
		logger.info({ optionCount: optionsToExplore.length }, 'Starting parallel exploration');

		// Create worktrees for each option
		const worktrees = await this.createWorktreesForOptions(optionsToExplore, context.baseBranch);

		// Start explorations in parallel - each forks from parent session
		const explorationPromises = optionsToExplore.map((option, index) => this.exploreOption(option, worktrees[index], context, parentSession));

		// Wait for all explorations
		const startTime = Date.now();
		const results = await Promise.all(explorationPromises);
		const totalDuration = Date.now() - startTime;

		const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
		const complete = results.every((r) => r.status === 'completed' || r.status === 'failed');

		logger.info(
			{
				optionCount: results.length,
				complete,
				totalCost,
				totalDuration,
			},
			'Parallel exploration finished',
		);

		return {
			options: results,
			complete,
			totalCost,
			totalDuration,
		};
	}

	/**
	 * Gets the selected option from human input
	 */
	async getHumanSelection(results: OptionExplorationResult[]): Promise<string> {
		if (!this.config.selectionCallback) {
			throw new Error('No selection callback configured');
		}

		logger.info({ optionCount: results.length }, 'Requesting human selection');
		return this.config.selectionCallback(results);
	}

	/**
	 * Finalizes exploration by merging selected option and cleaning up
	 */
	async finalize(results: ParallelExplorationResult, selectedOptionId: string, targetBranch: string): Promise<string> {
		const selectedResult = results.options.find((r) => r.optionId === selectedOptionId);
		if (!selectedResult) {
			throw new Error(`Selected option not found: ${selectedOptionId}`);
		}

		if (selectedResult.status !== 'completed') {
			throw new Error(`Cannot finalize incomplete option: ${selectedResult.status}`);
		}

		logger.info({ selectedOptionId, targetBranch }, 'Finalizing parallel exploration');

		// Merge the selected option's branch
		const mergeCommit = await this.config.worktreeService.mergeWorktreeBranch(
			selectedResult.worktree.id,
			targetBranch,
			true, // squash
		);

		// Clean up all worktrees
		for (const result of results.options) {
			const deleteBranch = result.optionId !== selectedOptionId;
			await this.config.worktreeService.removeWorktree(result.worktree.id, deleteBranch);
		}

		logger.info({ mergeCommit, selectedOptionId }, 'Parallel exploration finalized');
		return mergeCommit;
	}

	/**
	 * Cancels ongoing explorations and cleans up
	 */
	async cancel(): Promise<void> {
		logger.info({ activeCount: this.activeExplorations.size }, 'Cancelling parallel explorations');

		// Cancel all active explorations
		for (const exploration of this.activeExplorations.values()) {
			exploration.cancel();
		}

		// Clean up worktrees
		await this.config.worktreeService.cleanupAllWorktrees(true);
		this.activeExplorations.clear();
	}

	/**
	 * Gets status of active explorations
	 */
	getActiveExplorations(): Map<string, OptionExploration> {
		return new Map(this.activeExplorations);
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Creates worktrees for options
	 */
	private async createWorktreesForOptions(options: OptionDefinition[], baseBranch: string): Promise<Worktree[]> {
		const worktrees: Worktree[] = [];

		for (const option of options) {
			const branch = `parallel/${option.id}`;
			const worktree = await this.config.worktreeService.createWorktree({
				optionId: option.id,
				branch,
				base: baseBranch,
			});
			worktrees.push(worktree);
		}

		return worktrees;
	}

	/**
	 * Explores a single option in its worktree using a forked session
	 */
	private async exploreOption(
		option: OptionDefinition,
		worktree: Worktree,
		context: ParallelExplorationContext,
		parentSession: Session,
	): Promise<OptionExplorationResult> {
		const startTime = Date.now();
		this.updateStatus(option.id, 'in_progress', `Starting exploration of ${option.name}`);

		const exploration = new OptionExploration(option, worktree, context, parentSession, this.config.maxCostPerOption, this.config.maxIterationsPerOption);

		this.activeExplorations.set(option.id, exploration);

		try {
			const result = await exploration.execute();
			this.updateStatus(option.id, result.status, result.summary);

			// Get diff stats
			let diffStats: WorktreeDiffStats | undefined;
			let commits: string | undefined;
			try {
				diffStats = await this.config.worktreeService.getWorktreeDiffStats(worktree.id, context.baseCommit);
				commits = await this.config.worktreeService.getWorktreeCommitLog(worktree.id, context.baseCommit);
			} catch (e) {
				logger.warn({ optionId: option.id, error: e }, 'Failed to get diff stats');
			}

			return {
				optionId: option.id,
				optionName: option.name,
				status: result.status,
				worktree,
				diffStats,
				commits,
				summary: result.summary,
				cost: result.cost,
				duration: Date.now() - startTime,
			};
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			this.updateStatus(option.id, 'failed', error);

			return {
				optionId: option.id,
				optionName: option.name,
				status: 'failed',
				worktree,
				error,
				cost: exploration.cost,
				duration: Date.now() - startTime,
			};
		} finally {
			this.activeExplorations.delete(option.id);
		}
	}

	/**
	 * Updates status via callback
	 */
	private updateStatus(optionId: string, status: OptionExplorationStatus, message?: string): void {
		if (this.config.statusCallback) {
			this.config.statusCallback(optionId, status, message);
		}
	}
}

// ============================================================================
// Option Exploration
// ============================================================================

/**
 * Context for parallel exploration
 */
export interface ParallelExplorationContext {
	/** Parent task description */
	parentTask: string;
	/** Decision question being explored */
	decisionQuestion: string;
	/** Base branch */
	baseBranch: string;
	/** Base commit */
	baseCommit: string;
	/** Relevant learnings from knowledge base */
	knowledgeBase: Learning[];
	/** System prompt addition for forked sessions */
	systemPromptAddition?: string;
}

/**
 * Internal result from option exploration
 */
interface OptionExplorationInternalResult {
	status: OptionExplorationStatus;
	summary?: string;
	cost: number;
}

/**
 * Handles exploration of a single option using a forked session
 */
class OptionExploration {
	private option: OptionDefinition;
	private worktree: Worktree;
	private context: ParallelExplorationContext;
	private parentSession: Session;
	private maxCost: number;
	private maxIterations: number;
	private session: Session | null = null;
	private cancelled = false;
	public cost = 0;
	private iterations = 0;

	constructor(
		option: OptionDefinition,
		worktree: Worktree,
		context: ParallelExplorationContext,
		parentSession: Session,
		maxCost: number,
		maxIterations: number,
	) {
		this.option = option;
		this.worktree = worktree;
		this.context = context;
		this.parentSession = parentSession;
		this.maxCost = maxCost;
		this.maxIterations = maxIterations;
	}

	/**
	 * Executes the exploration using a forked session.
	 * The forked session inherits the parent's context (conversation history),
	 * so we only need to send the option-specific prompt.
	 */
	async execute(): Promise<OptionExplorationInternalResult> {
		logger.info({ optionId: this.option.id, worktree: this.worktree.path }, 'Starting option exploration');

		try {
			// Fork from parent session - inherits context, works in worktree
			// The forked session has all the parent's conversation history,
			// so we don't need to repeat context about the codebase.
			this.session = this.parentSession.fork({
				cwd: this.worktree.path,
			});

			// Send option-specific prompt (parent context is inherited)
			const optionPrompt = this.buildOptionPrompt();
			await this.sendMessage(optionPrompt);

			// Execute until completion or limits
			while (!this.cancelled && this.iterations < this.maxIterations && this.cost < this.maxCost) {
				// Check for completion
				const status = await this.checkCompletion();
				if (status.completed) {
					return {
						status: 'completed',
						summary: status.summary,
						cost: this.cost,
					};
				}

				this.iterations++;
			}

			// Hit limits
			if (this.cancelled) {
				return { status: 'cancelled', cost: this.cost };
			}

			return {
				status: 'completed',
				summary: `Exploration limit reached (${this.iterations} iterations, $${this.cost.toFixed(4)} cost)`,
				cost: this.cost,
			};
		} catch (e) {
			logger.error(e, 'Option exploration failed');
			throw e;
		}
	}

	/**
	 * Cancels the exploration
	 */
	cancel(): void {
		this.cancelled = true;
	}

	/**
	 * Builds the option-specific prompt for the forked session.
	 * Since the forked session inherits parent context (conversation history),
	 * we only need to explain the specific option to implement.
	 */
	private buildOptionPrompt(): string {
		const learningsStr = this.context.knowledgeBase.length > 0 ? this.context.knowledgeBase.map((l) => `- [${l.type}] ${l.content}`).join('\n') : '';

		return `
# Parallel Option Exploration

You are now exploring one of two parallel implementation options. Your work will be compared with the alternative option, and a human will select the winner.

## Decision Question
${this.context.decisionQuestion}

## Your Option to Implement
**${this.option.name}**: ${this.option.description}

**Pros**: ${this.option.pros.join(', ') || 'None specified'}
**Cons**: ${this.option.cons.join(', ') || 'None specified'}
${learningsStr ? `\n## Code Style & Patterns\n${learningsStr}` : ''}

## Guidelines
1. Implement the "${this.option.name}" approach thoroughly
2. Make regular commits with clear messages
3. Focus on demonstrating this approach's strengths
4. Don't try to implement the alternative approach
5. When complete, provide a summary of what you implemented

Begin implementing this option now.
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
	 * Checks if exploration is complete
	 */
	private async checkCompletion(): Promise<{ completed: boolean; summary?: string }> {
		// In a real implementation, this would check for completion markers
		// in the session output or tool state
		return { completed: false };
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a parallel explorer
 */
export function createParallelExplorer(config: ParallelExplorerConfig): ParallelExplorer {
	return new ParallelExplorer(config);
}

// ============================================================================
// V2: Feature-Based Parallel Exploration
// ============================================================================

/**
 * V2 configuration for feature-based parallel exploration.
 * Both worktrees implement the SAME feature using different approaches.
 */
export interface FeatureExplorationConfig extends ParallelExplorerConfig {
	/** Domain memory paths for recording decisions */
	domainMemoryPaths: DomainMemoryPaths;
	/** LLM for AI comparison when both options pass */
	comparisonLlm: LLM;
}

/**
 * Approach for implementing a feature
 */
export interface FeatureApproach {
	/** Unique ID for this approach */
	id: string;
	/** Name of the approach */
	name: string;
	/** Description of the approach */
	description: string;
	/** Why this approach might be better */
	rationale: string;
}

/**
 * Input for feature-based parallel exploration
 */
export interface FeatureExplorationInput {
	/** The feature to implement */
	feature: Feature;
	/** Two approaches to compare (exactly 2 required) */
	approaches: [FeatureApproach, FeatureApproach];
	/** Parent session context */
	parentSession: Session;
	/** Base branch to work from */
	baseBranch: string;
	/** Base commit */
	baseCommit: string;
	/** Knowledge base learnings */
	knowledgeBase: Learning[];
}

/**
 * Result from a single approach exploration
 */
export interface ApproachExplorationResult {
	/** Approach ID */
	approachId: string;
	/** Approach name */
	approachName: string;
	/** Whether implementation succeeded */
	implementationStatus: OptionExplorationStatus;
	/** Test result from running feature.testCommand */
	testResult?: TestResult;
	/** Worktree used */
	worktree: Worktree;
	/** Diff statistics */
	diffStats?: WorktreeDiffStats;
	/** Implementation summary */
	summary?: string;
	/** Commit log */
	commits?: string;
	/** Error if failed */
	error?: string;
	/** Cost incurred */
	cost: number;
	/** Time taken (ms) */
	duration: number;
}

/**
 * Result from feature-based parallel exploration
 */
export interface FeatureExplorationResult {
	/** Feature that was explored */
	feature: Feature;
	/** Results from both approaches */
	approaches: [ApproachExplorationResult, ApproachExplorationResult];
	/** Winner selection method */
	selectionMethod: 'both_passed_ai' | 'one_passed' | 'human_selection' | 'both_failed';
	/** Selected approach ID (if one was selected) */
	selectedApproachId?: string;
	/** Reasoning for selection */
	selectionReasoning: string;
	/** Total cost */
	totalCost: number;
	/** Total duration */
	totalDuration: number;
}

/**
 * Explores a feature using two different approaches in parallel.
 *
 * This v2 implementation:
 * 1. Creates worktrees for both approaches
 * 2. Implements the same feature in each worktree using different approaches
 * 3. Runs the feature's testCommand on both
 * 4. If both pass, uses AI to compare and select winner
 * 5. If only one passes, that one wins
 * 6. If neither passes, escalates to human
 * 7. Records the decision in domain memory
 */
export async function exploreFeatureApproaches(config: FeatureExplorationConfig, input: FeatureExplorationInput): Promise<FeatureExplorationResult> {
	const { feature, approaches, baseBranch, baseCommit } = input;
	const startTime = Date.now();

	logger.info(
		{
			featureId: feature.id,
			approaches: approaches.map((a) => a.name),
		},
		'Starting feature-based parallel exploration',
	);

	// Log exploration start in domain memory
	await logParallelExplorationStarted(
		config.domainMemoryPaths,
		feature.id,
		approaches.map((a) => a.id),
	);

	// Create worktrees for both approaches
	const worktrees = await createWorktreesForApproaches(config.worktreeService, feature.id, approaches, baseBranch);

	// Build exploration context for each approach
	const explorationContexts = approaches.map((approach, index) => buildApproachContext(feature, approach, input.knowledgeBase, baseBranch, baseCommit));

	// Start parallel implementation
	const explorationPromises = approaches.map((approach, index) =>
		exploreApproach(config, approach, feature, worktrees[index], explorationContexts[index], input.parentSession),
	);

	const results = await Promise.all(explorationPromises);
	const totalDuration = Date.now() - startTime;
	const totalCost = results.reduce((sum, r) => sum + r.cost, 0);

	// Run tests on both approaches
	logger.info({ featureId: feature.id }, 'Running tests on both approaches');
	const testResults = await Promise.all(results.map((r) => runTestInWorktree(feature, r.worktree.path)));

	// Update results with test outcomes
	results[0].testResult = testResults[0];
	results[1].testResult = testResults[1];

	// Determine winner
	const { selectedApproachId, selectionMethod, reasoning } = await determineWinner(config, feature, results, testResults);

	// Log completion in domain memory
	await logParallelExplorationComplete(config.domainMemoryPaths, feature.id, selectedApproachId || 'none', selectionMethod, reasoning);

	logger.info(
		{
			featureId: feature.id,
			selectedApproachId,
			selectionMethod,
			totalCost,
			totalDuration,
		},
		'Feature-based parallel exploration complete',
	);

	return {
		feature,
		approaches: [results[0], results[1]],
		selectionMethod,
		selectedApproachId,
		selectionReasoning: reasoning,
		totalCost,
		totalDuration,
	};
}

/**
 * Finalizes feature exploration by merging winner and cleaning up
 */
export async function finalizeFeatureExploration(
	config: FeatureExplorationConfig,
	result: FeatureExplorationResult,
	targetBranch: string,
): Promise<string | null> {
	if (!result.selectedApproachId) {
		logger.warn({ featureId: result.feature.id }, 'No approach selected, cannot finalize');
		return null;
	}

	const selectedResult = result.approaches.find((r) => r.approachId === result.selectedApproachId);

	if (!selectedResult) {
		throw new Error(`Selected approach not found: ${result.selectedApproachId}`);
	}

	logger.info(
		{
			featureId: result.feature.id,
			selectedApproachId: result.selectedApproachId,
			targetBranch,
		},
		'Finalizing feature exploration',
	);

	// Merge the selected approach's branch
	const mergeCommit = await config.worktreeService.mergeWorktreeBranch(
		selectedResult.worktree.id,
		targetBranch,
		true, // squash
	);

	// Clean up all worktrees
	for (const approachResult of result.approaches) {
		const deleteBranch = approachResult.approachId !== result.selectedApproachId;
		await config.worktreeService.removeWorktree(approachResult.worktree.id, deleteBranch);
	}

	return mergeCommit;
}

// ============================================================================
// V2 Internal Functions
// ============================================================================

async function createWorktreesForApproaches(
	worktreeService: GitWorktreeService,
	featureId: string,
	approaches: FeatureApproach[],
	baseBranch: string,
): Promise<Worktree[]> {
	const worktrees: Worktree[] = [];

	for (const approach of approaches) {
		const branch = `parallel/${featureId}/${approach.id}`;
		const worktree = await worktreeService.createWorktree({
			optionId: approach.id,
			branch,
			base: baseBranch,
		});
		worktrees.push(worktree);
	}

	return worktrees;
}

function buildApproachContext(
	feature: Feature,
	approach: FeatureApproach,
	knowledgeBase: Learning[],
	baseBranch: string,
	baseCommit: string,
): ParallelExplorationContext {
	return {
		parentTask: feature.description,
		decisionQuestion: `How should we implement feature "${feature.id}"?`,
		baseBranch,
		baseCommit,
		knowledgeBase,
		systemPromptAddition: `
You are implementing the feature using the "${approach.name}" approach.

Feature: ${feature.description}
Approach: ${approach.description}
Rationale: ${approach.rationale}

Test Command: ${feature.testCommand}

Your goal is to implement this feature such that the test command passes.
Make regular commits with clear messages.
`,
	};
}

async function exploreApproach(
	config: FeatureExplorationConfig,
	approach: FeatureApproach,
	feature: Feature,
	worktree: Worktree,
	context: ParallelExplorationContext,
	parentSession: Session,
): Promise<ApproachExplorationResult> {
	const startTime = Date.now();

	// Convert approach to option for compatibility with existing exploration
	const option: OptionDefinition = {
		id: approach.id,
		name: approach.name,
		description: approach.description,
		pros: [approach.rationale],
		cons: [],
	};

	const exploration = new OptionExploration(option, worktree, context, parentSession, config.maxCostPerOption, config.maxIterationsPerOption);

	try {
		const result = await exploration.execute();

		// Get diff stats
		let diffStats: WorktreeDiffStats | undefined;
		let commits: string | undefined;
		try {
			diffStats = await config.worktreeService.getWorktreeDiffStats(worktree.id, context.baseCommit);
			commits = await config.worktreeService.getWorktreeCommitLog(worktree.id, context.baseCommit);
		} catch (e) {
			logger.warn({ approachId: approach.id, error: e }, 'Failed to get diff stats');
		}

		return {
			approachId: approach.id,
			approachName: approach.name,
			implementationStatus: result.status,
			worktree,
			diffStats,
			commits,
			summary: result.summary,
			cost: result.cost,
			duration: Date.now() - startTime,
		};
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);

		return {
			approachId: approach.id,
			approachName: approach.name,
			implementationStatus: 'failed',
			worktree,
			error,
			cost: exploration.cost,
			duration: Date.now() - startTime,
		};
	}
}

async function runTestInWorktree(feature: Feature, worktreePath: string): Promise<TestResult> {
	return runFeatureTest(feature, worktreePath);
}

async function determineWinner(
	config: FeatureExplorationConfig,
	feature: Feature,
	results: ApproachExplorationResult[],
	testResults: TestResult[],
): Promise<{
	selectedApproachId?: string;
	selectionMethod: FeatureExplorationResult['selectionMethod'];
	reasoning: string;
}> {
	const [result1, result2] = results;
	const [test1, test2] = testResults;

	// Case 1: Both tests pass - use AI to compare
	if (test1.passed && test2.passed) {
		logger.info({ featureId: feature.id }, 'Both approaches passed tests, using AI comparison');

		const aiComparison = await compareApproachesWithAI(config.comparisonLlm, feature, result1, result2);

		return {
			selectedApproachId: aiComparison.winnerId,
			selectionMethod: 'both_passed_ai',
			reasoning: aiComparison.reasoning,
		};
	}

	// Case 2: Only one passes - that one wins
	if (test1.passed && !test2.passed) {
		return {
			selectedApproachId: result1.approachId,
			selectionMethod: 'one_passed',
			reasoning: `${result1.approachName} passed tests while ${result2.approachName} failed: ${test2.error || 'Tests did not pass'}`,
		};
	}

	if (!test1.passed && test2.passed) {
		return {
			selectedApproachId: result2.approachId,
			selectionMethod: 'one_passed',
			reasoning: `${result2.approachName} passed tests while ${result1.approachName} failed: ${test1.error || 'Tests did not pass'}`,
		};
	}

	// Case 3: Neither passes - needs human intervention
	return {
		selectionMethod: 'both_failed',
		reasoning: `Both approaches failed tests. ${result1.approachName}: ${test1.error || 'Tests did not pass'}. ${result2.approachName}: ${test2.error || 'Tests did not pass'}`,
	};
}

interface AIComparisonResult {
	winnerId: string;
	reasoning: string;
}

async function compareApproachesWithAI(
	llm: LLM,
	feature: Feature,
	result1: ApproachExplorationResult,
	result2: ApproachExplorationResult,
): Promise<AIComparisonResult> {
	const prompt = `
# Compare Two Implementation Approaches

You are comparing two implementations of the same feature. Both implementations pass the test suite.
Select the better approach based on code quality, maintainability, and design.

## Feature
${feature.description}

## Approach 1: ${result1.approachName}
Summary: ${result1.summary || 'No summary available'}
Lines changed: +${result1.diffStats?.insertions || 0} -${result1.diffStats?.deletions || 0}
Files: ${result1.diffStats?.filesChanged || 0}
Commits:
${result1.commits || 'No commits available'}

## Approach 2: ${result2.approachName}
Summary: ${result2.summary || 'No summary available'}
Lines changed: +${result2.diffStats?.insertions || 0} -${result2.diffStats?.deletions || 0}
Files: ${result2.diffStats?.filesChanged || 0}
Commits:
${result2.commits || 'No commits available'}

## Instructions
Choose the better approach and explain your reasoning. Consider:
- Code simplicity and readability
- Maintainability
- Performance (if relevant)
- Alignment with existing patterns

Respond with JSON:
\`\`\`json
{
  "winnerId": "${result1.approachId}" or "${result2.approachId}",
  "reasoning": "Explanation of why this approach is better"
}
\`\`\`
`;

	try {
		const response = await llm.generateText(prompt, undefined);

		// Parse JSON from response
		const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[1]);
			return {
				winnerId: parsed.winnerId,
				reasoning: parsed.reasoning,
			};
		}

		// Fallback to parsing raw JSON
		const parsed = JSON.parse(response);
		return {
			winnerId: parsed.winnerId,
			reasoning: parsed.reasoning,
		};
	} catch (e) {
		logger.warn({ error: e }, 'AI comparison failed, defaulting to first approach');
		return {
			winnerId: result1.approachId,
			reasoning: `AI comparison failed: ${e instanceof Error ? e.message : String(e)}. Defaulting to first approach.`,
		};
	}
}
