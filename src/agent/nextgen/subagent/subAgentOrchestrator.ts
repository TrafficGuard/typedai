/**
 * Sub-Agent Orchestrator for NextGen Agent
 *
 * Manages spawning, coordination, and aggregation of sub-agents.
 * Supports multiple orchestration patterns:
 * - task_decomposition: Break task into independent subtasks
 * - multi_perspective: Same task, different approaches
 * - pipeline: Sequential stages
 * - specialist: Single specialized sub-agent
 */

import { randomUUID } from 'node:crypto';
import { logger } from '#o11y/logger';
import type { NextGenAgentContext, SubAgentConfig, SubAgentCoordination, SubAgentExecution, SubAgentResult, SubAgentSpawnConfig } from '../core/types';

/**
 * Configuration for the orchestrator
 */
export interface OrchestratorConfig {
	/** Default max iterations for sub-agents */
	defaultMaxIterations?: number;
	/** Default budget fraction per sub-agent (0-1) */
	defaultBudgetFraction?: number;
	/** Whether to enforce budget limits strictly */
	strictBudgetEnforcement?: boolean;
	/** Timeout for individual sub-agent execution (ms) */
	executionTimeout?: number;
}

/**
 * Factory function for creating sub-agent contexts
 */
export type SubAgentContextFactory = (parent: NextGenAgentContext, config: SubAgentConfig, task: string) => Promise<NextGenAgentContext>;

/**
 * Executor function for running sub-agents
 */
export type SubAgentExecutor = (context: NextGenAgentContext) => Promise<SubAgentResult>;

/**
 * Manages sub-agent spawning, execution, and result aggregation
 */
export class SubAgentOrchestrator {
	private config: Required<OrchestratorConfig>;
	private contextFactory?: SubAgentContextFactory;
	private executor?: SubAgentExecutor;

	constructor(config: OrchestratorConfig = {}) {
		this.config = {
			defaultMaxIterations: config.defaultMaxIterations ?? 10,
			defaultBudgetFraction: config.defaultBudgetFraction ?? 0.2,
			strictBudgetEnforcement: config.strictBudgetEnforcement ?? true,
			executionTimeout: config.executionTimeout ?? 300000, // 5 minutes
		};
	}

	/**
	 * Sets the context factory for creating sub-agent contexts
	 */
	setContextFactory(factory: SubAgentContextFactory): void {
		this.contextFactory = factory;
	}

	/**
	 * Sets the executor for running sub-agents
	 */
	setExecutor(executor: SubAgentExecutor): void {
		this.executor = executor;
	}

	/**
	 * Spawns sub-agents according to the spawn configuration
	 */
	async spawn(parent: NextGenAgentContext, spawnConfig: SubAgentSpawnConfig, taskDescription: string): Promise<SubAgentExecution[]> {
		if (!this.contextFactory) {
			throw new Error('SubAgentOrchestrator: context factory not set');
		}
		if (!this.executor) {
			throw new Error('SubAgentOrchestrator: executor not set');
		}

		logger.info(`Spawning ${spawnConfig.agents.length} sub-agents with pattern: ${spawnConfig.pattern}`);

		// Calculate budget distribution
		const totalBudget = spawnConfig.budget ?? parent.budgetRemaining ?? 10.0;
		const budgetPerAgent = this.calculateBudgetDistribution(spawnConfig.agents, totalBudget);

		const executions: SubAgentExecution[] = [];

		for (let i = 0; i < spawnConfig.agents.length; i++) {
			const agentConfig = spawnConfig.agents[i];
			const budget = budgetPerAgent[i];

			const execution = await this.createExecution(parent, agentConfig, taskDescription, budget, spawnConfig.coordination);

			executions.push(execution);

			// Track in parent context
			parent.activeSubAgents.set(execution.id, execution);
		}

		// Start executions based on coordination type
		if (spawnConfig.coordination.type === 'parallel') {
			// All start immediately (already done above)
			logger.debug('Started all sub-agents in parallel');
		} else if (spawnConfig.coordination.type === 'sequential') {
			// Sequential execution is handled by awaitSequential
			logger.debug('Sub-agents will execute sequentially');
		}

		return executions;
	}

	/**
	 * Awaits all executions and returns results
	 */
	async awaitAll(executions: SubAgentExecution[], timeout?: number): Promise<SubAgentResult[]> {
		const timeoutMs = timeout ?? this.config.executionTimeout;

		const results = await Promise.all(executions.map((exec) => this.awaitWithTimeout(exec.promise, timeoutMs, exec.id)));

		return results;
	}

	/**
	 * Spawns and executes sub-agents sequentially, one at a time
	 * This ensures true sequential execution where later agents don't start
	 * until earlier ones complete.
	 */
	async spawnAndExecuteSequentially(
		parent: NextGenAgentContext,
		spawnConfig: SubAgentSpawnConfig,
		taskDescription: string,
		passContext = false,
	): Promise<SubAgentResult[]> {
		if (!this.contextFactory) {
			throw new Error('SubAgentOrchestrator: context factory not set');
		}
		if (!this.executor) {
			throw new Error('SubAgentOrchestrator: executor not set');
		}

		logger.info(`Executing ${spawnConfig.agents.length} sub-agents sequentially with pattern: ${spawnConfig.pattern}`);

		const totalBudget = spawnConfig.budget ?? parent.budgetRemaining ?? 10.0;
		const budgetPerAgent = this.calculateBudgetDistribution(spawnConfig.agents, totalBudget);

		const results: SubAgentResult[] = [];
		let previousOutput: string | undefined;

		for (let i = 0; i < spawnConfig.agents.length; i++) {
			const agentConfig = spawnConfig.agents[i];
			const budget = budgetPerAgent[i];

			// Create context for this agent
			const subContext = await this.contextFactory(parent, agentConfig, taskDescription);
			subContext.budgetRemaining = budget;
			subContext.maxIterations = agentConfig.maxIterations ?? this.config.defaultMaxIterations;

			// Pass context from previous agent if configured
			if (passContext && previousOutput) {
				subContext.structuredMemory.previousAgentOutput = previousOutput;
				logger.debug(`Passed context from previous agent to ${agentConfig.name}`);
			}

			// Execute this agent
			try {
				const result = await this.executor(subContext);
				results.push(result);
				parent.completedSubAgentResults.push(result);
				previousOutput = result.output;

				// Stop on error
				if (result.state === 'error') {
					logger.warn(`Sequential execution stopped due to error in ${agentConfig.name}`);
					break;
				}
			} catch (error) {
				const errorResult: SubAgentResult = {
					agentId: subContext.agentId,
					name: agentConfig.name,
					output: '',
					state: 'error',
					error: (error as Error).message ?? String(error),
					cost: subContext.cost ?? 0,
					iterations: subContext.iterations ?? 0,
				};
				results.push(errorResult);
				parent.completedSubAgentResults.push(errorResult);
				logger.warn(`Sequential execution stopped due to error in ${agentConfig.name}`);
				break;
			}
		}

		return results;
	}

	/**
	 * Awaits executions sequentially (for already-started parallel executions)
	 * Note: All executions are already running - this just awaits them in order.
	 * For true sequential execution, use spawnAndExecuteSequentially instead.
	 */
	async awaitSequential(executions: SubAgentExecution[], _passContext = false): Promise<SubAgentResult[]> {
		const results: SubAgentResult[] = [];

		for (const exec of executions) {
			const result = await this.awaitWithTimeout(exec.promise, this.config.executionTimeout, exec.id);

			results.push(result);

			// Stop collecting on error
			if (result.state === 'error') {
				logger.warn(`Sequential execution stopped due to error in ${exec.id}`);
				break;
			}
		}

		return results;
	}

	/**
	 * Aggregates results from multiple sub-agents
	 */
	aggregate(results: SubAgentResult[], coordination: SubAgentCoordination): AggregatedResult {
		const strategy = coordination.aggregation ?? 'merge';

		switch (strategy) {
			case 'merge':
				return this.aggregateMerge(results);
			case 'vote':
				return this.aggregateVote(results);
			case 'best':
				return this.aggregateBest(results);
			case 'pipeline':
				return this.aggregatePipeline(results);
			default:
				return this.aggregateMerge(results);
		}
	}

	/**
	 * Cancels all running sub-agents
	 */
	cancelAll(parent: NextGenAgentContext): number {
		let cancelled = 0;
		for (const [id, execution] of parent.activeSubAgents) {
			execution.cancel();
			cancelled++;
			logger.debug(`Cancelled sub-agent ${id}`);
		}
		parent.activeSubAgents.clear();
		return cancelled;
	}

	/**
	 * Gets the configuration
	 */
	getConfig(): Required<OrchestratorConfig> {
		return { ...this.config };
	}

	// Private methods

	private calculateBudgetDistribution(agents: SubAgentConfig[], totalBudget: number): number[] {
		const budgets: number[] = [];
		let remainingBudget = totalBudget;
		let agentsWithoutBudget = 0;

		// First pass: allocate specified budgets
		for (const agent of agents) {
			if (agent.budgetFraction !== undefined) {
				budgets.push(totalBudget * agent.budgetFraction);
				remainingBudget -= totalBudget * agent.budgetFraction;
			} else {
				budgets.push(-1); // Placeholder
				agentsWithoutBudget++;
			}
		}

		// Second pass: distribute remaining budget evenly
		const defaultBudget = agentsWithoutBudget > 0 ? remainingBudget / agentsWithoutBudget : 0;
		for (let i = 0; i < budgets.length; i++) {
			if (budgets[i] === -1) {
				budgets[i] = Math.max(defaultBudget, totalBudget * this.config.defaultBudgetFraction);
			}
		}

		return budgets;
	}

	private async createExecution(
		parent: NextGenAgentContext,
		agentConfig: SubAgentConfig,
		taskDescription: string,
		budget: number,
		coordination: SubAgentCoordination,
	): Promise<SubAgentExecution> {
		const id = randomUUID();
		let cancelled = false;

		// Create the sub-agent context
		const subContext = await this.contextFactory!(parent, agentConfig, taskDescription);

		// Set budget limit on sub-context
		subContext.budgetRemaining = budget;
		subContext.maxIterations = agentConfig.maxIterations ?? this.config.defaultMaxIterations;

		// Create the execution promise
		const promise = new Promise<SubAgentResult>((resolve) => {
			// Check for immediate cancellation
			if (cancelled) {
				resolve({
					agentId: id,
					name: agentConfig.name,
					output: '',
					state: 'cancelled',
					cost: 0,
					iterations: 0,
				});
				return;
			}

			// Execute the sub-agent
			this.executor!(subContext)
				.then((result) => {
					// Move from active to completed in parent
					parent.activeSubAgents.delete(id);
					parent.completedSubAgentResults.push(result);
					resolve(result);
				})
				.catch((error) => {
					parent.activeSubAgents.delete(id);
					const errorResult: SubAgentResult = {
						agentId: id,
						name: agentConfig.name,
						output: '',
						state: 'error',
						error: error.message ?? String(error),
						cost: subContext.cost ?? 0,
						iterations: subContext.iterations ?? 0,
					};
					parent.completedSubAgentResults.push(errorResult);
					resolve(errorResult);
				});
		});

		return {
			id,
			promise,
			cancel: () => {
				cancelled = true;
				logger.debug(`Sub-agent ${id} (${agentConfig.name}) cancelled`);
			},
		};
	}

	private async awaitWithTimeout(promise: Promise<SubAgentResult>, timeoutMs: number, id: string): Promise<SubAgentResult> {
		const timeoutPromise = new Promise<SubAgentResult>((resolve) => {
			setTimeout(() => {
				resolve({
					agentId: id,
					name: 'unknown',
					output: '',
					state: 'timeout',
					error: `Execution timed out after ${timeoutMs}ms`,
					cost: 0,
					iterations: 0,
				});
			}, timeoutMs);
		});

		return Promise.race([promise, timeoutPromise]);
	}

	private aggregateMerge(results: SubAgentResult[]): AggregatedResult {
		// Merge all outputs and data
		const outputs = results.filter((r) => r.state === 'completed').map((r) => r.output);
		const mergedData: Record<string, unknown> = {};

		for (const result of results) {
			if (result.data) {
				for (const [key, value] of Object.entries(result.data)) {
					if (Array.isArray(value) && Array.isArray(mergedData[key])) {
						mergedData[key] = [...(mergedData[key] as unknown[]), ...value];
					} else if (mergedData[key] === undefined) {
						mergedData[key] = value;
					}
				}
			}
		}

		return {
			strategy: 'merge',
			output: outputs.join('\n\n---\n\n'),
			data: mergedData,
			successCount: results.filter((r) => r.state === 'completed').length,
			totalCount: results.length,
			totalCost: results.reduce((sum, r) => sum + r.cost, 0),
		};
	}

	private aggregateVote(results: SubAgentResult[]): AggregatedResult {
		// Vote on the best result (simplified: pick the one with most complete output)
		const completedResults = results.filter((r) => r.state === 'completed');

		if (completedResults.length === 0) {
			return {
				strategy: 'vote',
				output: '',
				data: {},
				successCount: 0,
				totalCount: results.length,
				totalCost: results.reduce((sum, r) => sum + r.cost, 0),
			};
		}

		// Simple voting: longest output wins (in practice, would use semantic comparison)
		const best = completedResults.reduce((a, b) => (a.output.length > b.output.length ? a : b));

		return {
			strategy: 'vote',
			output: best.output,
			data: best.data ?? {},
			successCount: completedResults.length,
			totalCount: results.length,
			totalCost: results.reduce((sum, r) => sum + r.cost, 0),
			selectedAgent: best.name,
		};
	}

	private aggregateBest(results: SubAgentResult[]): AggregatedResult {
		// Pick the "best" result based on state and completeness
		const completedResults = results.filter((r) => r.state === 'completed');

		if (completedResults.length === 0) {
			return {
				strategy: 'best',
				output: '',
				data: {},
				successCount: 0,
				totalCount: results.length,
				totalCost: results.reduce((sum, r) => sum + r.cost, 0),
			};
		}

		// Pick the one with the most data or longest output
		const best = completedResults.reduce((a, b) => {
			const aScore = (a.output.length || 0) + Object.keys(a.data || {}).length * 100;
			const bScore = (b.output.length || 0) + Object.keys(b.data || {}).length * 100;
			return aScore > bScore ? a : b;
		});

		return {
			strategy: 'best',
			output: best.output,
			data: best.data ?? {},
			successCount: completedResults.length,
			totalCount: results.length,
			totalCost: results.reduce((sum, r) => sum + r.cost, 0),
			selectedAgent: best.name,
		};
	}

	private aggregatePipeline(results: SubAgentResult[]): AggregatedResult {
		// Pipeline: use the final result, with accumulated data
		const accumulatedData: Record<string, unknown> = {};

		for (const result of results) {
			if (result.data) {
				Object.assign(accumulatedData, result.data);
			}
		}

		const lastCompleted = [...results].reverse().find((r) => r.state === 'completed');

		return {
			strategy: 'pipeline',
			output: lastCompleted?.output ?? '',
			data: accumulatedData,
			successCount: results.filter((r) => r.state === 'completed').length,
			totalCount: results.length,
			totalCost: results.reduce((sum, r) => sum + r.cost, 0),
		};
	}
}

/**
 * Result of aggregating multiple sub-agent results
 */
export interface AggregatedResult {
	/** Strategy used for aggregation */
	strategy: 'merge' | 'vote' | 'best' | 'pipeline';
	/** Combined/selected output */
	output: string;
	/** Merged/selected data */
	data: Record<string, unknown>;
	/** Number of successful sub-agents */
	successCount: number;
	/** Total number of sub-agents */
	totalCount: number;
	/** Total cost across all sub-agents */
	totalCost: number;
	/** Selected agent name (for vote/best strategies) */
	selectedAgent?: string;
}

/**
 * Creates the Agent_spawnSubAgent function for agent use
 */
export function createSpawnSubAgentFunction(orchestrator: SubAgentOrchestrator) {
	return async function Agent_spawnSubAgent(
		parent: NextGenAgentContext,
		taskDescription: string,
		role: 'search' | 'analysis' | 'implementation' | 'verification',
		options?: { llmTier?: 'easy' | 'medium' | 'hard' | 'xhard'; maxIterations?: number },
	): Promise<string> {
		const [execution] = await orchestrator.spawn(
			parent,
			{
				pattern: 'specialist',
				agents: [
					{
						name: `${parent.name}_${role}`,
						role,
						llmLevel: options?.llmTier ?? 'medium',
						maxIterations: options?.maxIterations,
					},
				],
				coordination: { type: 'sequential', passContext: true },
			},
			taskDescription,
		);

		const result = await execution.promise;

		if (result.state === 'error') {
			throw new Error(`Sub-agent failed: ${result.error}`);
		}

		return result.output;
	};
}
