/**
 * Metrics Collector Service for NextGen Agent
 *
 * Orchestrates metrics collection across LLM calls, iterations, and tasks.
 */

import { logger } from '#o11y/logger';
import type { AutonomousIteration, DecisionType, ProgressSignal } from '#shared/agent/agent.model';
import type { CheckpointResult, IterationPatternSummary, TaskEvaluation, TaskStatus } from '#shared/evaluation/taskEvaluation.model';
import type { LlmCall, LlmCallMetricsAggregate } from '#shared/llmCall/llmCall.model';
import {
	calculateIterationSimilarity,
	calculateProgressSignal,
	countFileOperations,
	detectLoop,
	inferDecisionType,
	type LoopDetectionResult,
} from './progressDetector';

/**
 * Builder for collecting metrics during an iteration
 */
export class IterationMetricsBuilder {
	private metrics: Partial<AutonomousIteration>;
	private llmCalls: LlmCall[] = [];
	private startTime: number;
	private previousIteration?: Partial<AutonomousIteration>;

	constructor(agentId: string, iteration: number, previousIteration?: Partial<AutonomousIteration>) {
		this.startTime = Date.now();
		this.metrics = {
			agentId,
			iteration,
			createdAt: this.startTime,
		};
		this.previousIteration = previousIteration;
	}

	/**
	 * Records an LLM call made during this iteration
	 */
	recordLlmCall(call: LlmCall): void {
		this.llmCalls.push(call);
	}

	/**
	 * Records test results from this iteration
	 */
	recordTestResults(testsRun: number, passed: number, failed: number): void {
		this.metrics.testsRun = testsRun;
		this.metrics.testsPassed = passed;
		this.metrics.testsFailed = failed;
	}

	/**
	 * Records compile status
	 */
	recordCompileStatus(success: boolean): void {
		this.metrics.compileSuccess = success;
	}

	/**
	 * Records lint error delta
	 */
	recordLintDelta(delta: number): void {
		this.metrics.lintErrorsDelta = delta;
	}

	/**
	 * Finalizes the iteration metrics
	 */
	finalize(iterationData: Partial<AutonomousIteration>): AutonomousIteration {
		// Calculate file operation metrics from function calls
		const functionCalls = iterationData.functionCalls || [];
		const fileOps = countFileOperations(functionCalls);

		// Calculate LLM aggregates
		const llmMetrics = this.calculateLlmAggregates();

		// Calculate similarity to previous iteration
		const similarity = this.previousIteration ? calculateIterationSimilarity({ ...this.metrics, ...iterationData }, this.previousIteration) : 0;

		// Calculate progress signal
		const { signal, confidence } = calculateProgressSignal({ ...this.metrics, ...iterationData, similarityToPrevious: similarity }, this.previousIteration);

		// Infer decision type
		const decisionType = inferDecisionType({ ...this.metrics, ...iterationData });

		return {
			...iterationData,
			agentId: this.metrics.agentId!,
			iteration: this.metrics.iteration!,
			createdAt: this.metrics.createdAt,

			// File operations
			filesRead: fileOps.filesRead,
			filesModified: fileOps.filesModified,
			linesAdded: fileOps.linesAdded,
			linesRemoved: fileOps.linesRemoved,

			// Quality metrics
			compileSuccess: this.metrics.compileSuccess,
			testsRun: this.metrics.testsRun,
			testsPassed: this.metrics.testsPassed,
			testsFailed: this.metrics.testsFailed,
			lintErrorsDelta: this.metrics.lintErrorsDelta,

			// Progress metrics
			similarityToPrevious: similarity,
			progressSignal: signal,
			progressConfidence: confidence,
			decisionType,

			// LLM metrics
			...llmMetrics,
		} as AutonomousIteration;
	}

	private calculateLlmAggregates(): {
		llmCallCount: number;
		llmTotalCost: number;
		llmTotalInputTokens: number;
		llmTotalOutputTokens: number;
		llmCacheHitRatio: number;
	} {
		const callCount = this.llmCalls.length;
		let totalCost = 0;
		let totalInput = 0;
		let totalOutput = 0;
		let totalCached = 0;

		for (const call of this.llmCalls) {
			totalCost += call.cost ?? 0;
			totalInput += call.inputTokens ?? 0;
			totalOutput += call.outputTokens ?? 0;
			totalCached += call.cachedInputTokens ?? 0;
		}

		return {
			llmCallCount: callCount,
			llmTotalCost: totalCost,
			llmTotalInputTokens: totalInput,
			llmTotalOutputTokens: totalOutput,
			llmCacheHitRatio: totalInput > 0 ? totalCached / totalInput : 0,
		};
	}
}

/**
 * Service for collecting and aggregating agent metrics
 */
export class MetricsCollectorService {
	private iterationHistory: Map<string, Partial<AutonomousIteration>[]> = new Map();
	private taskStartTimes: Map<string, number> = new Map();
	private taskLlmCalls: Map<string, LlmCall[]> = new Map();
	private taskCheckpoints: Map<string, CheckpointResult[]> = new Map();

	/**
	 * Starts collecting metrics for a new iteration
	 */
	startIteration(agentId: string, iteration: number): IterationMetricsBuilder {
		const history = this.iterationHistory.get(agentId) || [];
		const previousIteration = history.length > 0 ? history[history.length - 1] : undefined;

		return new IterationMetricsBuilder(agentId, iteration, previousIteration);
	}

	/**
	 * Records a completed iteration
	 */
	recordIteration(iteration: AutonomousIteration): void {
		const history = this.iterationHistory.get(iteration.agentId) || [];
		history.push(iteration);

		// Keep only recent history for memory efficiency
		if (history.length > 50) {
			history.shift();
		}

		this.iterationHistory.set(iteration.agentId, history);
	}

	/**
	 * Records an LLM call for task-level aggregation
	 */
	recordLlmCall(taskId: string, call: LlmCall): void {
		const calls = this.taskLlmCalls.get(taskId) || [];
		calls.push(call);
		this.taskLlmCalls.set(taskId, calls);
	}

	/**
	 * Records a checkpoint result
	 */
	recordCheckpoint(taskId: string, checkpoint: CheckpointResult): void {
		const checkpoints = this.taskCheckpoints.get(taskId) || [];
		checkpoints.push(checkpoint);
		this.taskCheckpoints.set(taskId, checkpoints);
	}

	/**
	 * Marks task start for duration tracking
	 */
	startTask(taskId: string): void {
		this.taskStartTimes.set(taskId, Date.now());
		this.taskLlmCalls.set(taskId, []);
		this.taskCheckpoints.set(taskId, []);
	}

	/**
	 * Detects if the agent is stuck in a loop
	 */
	detectLoop(agentId: string, lookback: number = 5): LoopDetectionResult {
		const history = this.iterationHistory.get(agentId) || [];
		return detectLoop(history, { lookbackWindow: lookback, similarityThreshold: 0.85, minLoopLength: 3 });
	}

	/**
	 * Gets aggregate LLM metrics for a task
	 */
	getLlmMetricsForTask(taskId: string): LlmCallMetricsAggregate {
		const calls = this.taskLlmCalls.get(taskId) || [];
		return this.aggregateLlmCalls(calls);
	}

	/**
	 * Creates a complete task evaluation
	 */
	createTaskEvaluation(taskId: string, agentId: string, taskDescription: string, status: TaskStatus, output?: string, error?: string): TaskEvaluation {
		const startTime = this.taskStartTimes.get(taskId) || Date.now();
		const endTime = Date.now();
		const history = this.iterationHistory.get(agentId) || [];
		const llmCalls = this.taskLlmCalls.get(taskId) || [];
		const checkpoints = this.taskCheckpoints.get(taskId) || [];

		const llmMetrics = this.aggregateLlmCalls(llmCalls);
		const iterationPatterns = this.analyzeIterationPatterns(history);

		// Calculate file change totals
		let filesCreated = 0;
		let filesModified = 0;
		let linesAdded = 0;
		let linesRemoved = 0;

		for (const iter of history) {
			filesModified += iter.filesModified ?? 0;
			linesAdded += iter.linesAdded ?? 0;
			linesRemoved += iter.linesRemoved ?? 0;
		}

		// Count stuck episodes
		let stuckCount = 0;
		for (const iter of history) {
			if (iter.progressSignal === 'stuck') {
				stuckCount++;
			}
		}

		// Count errors and recoveries
		let errorCount = 0;
		let recoveries = 0;
		for (let i = 0; i < history.length; i++) {
			if (history[i].error) {
				errorCount++;
				// Check if next iteration resolved it
				if (i + 1 < history.length && !history[i + 1].error) {
					recoveries++;
				}
			}
		}

		const evaluation: TaskEvaluation = {
			taskId,
			agentId,
			taskDescription,
			status,
			output,
			error,

			totalIterations: history.length,
			totalDurationMs: endTime - startTime,
			totalCostUsd: llmMetrics.totalCost,

			totalInputTokens: llmMetrics.totalInputTokens,
			totalOutputTokens: llmMetrics.totalOutputTokens,
			totalCachedTokens: llmMetrics.totalCachedTokens,
			overallCacheHitRatio: llmMetrics.cacheHitRatio,
			totalReasoningTokens: llmMetrics.totalReasoningTokens,

			compactionCount: 0, // Would need to be tracked separately
			stuckCount,
			humanInterventions: 0, // Would need to be tracked separately
			errorCount,
			errorRecoveryRate: errorCount > 0 ? recoveries / errorCount : 1,

			checkpointResults: checkpoints,
			iterationPatterns,

			learningsCount: 0, // Would be filled by learning extractor
			filesCreated,
			filesModified,
			filesDeleted: 0, // Would need explicit tracking
			netLinesChanged: linesAdded - linesRemoved,

			startedAt: startTime,
			completedAt: status !== 'running' ? endTime : undefined,
		};

		logger.info(
			{
				taskId,
				status,
				iterations: evaluation.totalIterations,
				cost: evaluation.totalCostUsd,
				duration: evaluation.totalDurationMs,
			},
			'Task evaluation created',
		);

		return evaluation;
	}

	/**
	 * Gets a summary of task progress for checkpoint review
	 */
	getTaskProgressSummary(
		taskId: string,
		agentId: string,
	): {
		iterationsCompleted: number;
		costSoFar: number;
		timeElapsedMs: number;
		isStuck: boolean;
		recentProgress: ProgressSignal[];
		checkpointsPassed: number;
		checkpointsFailed: number;
	} {
		const startTime = this.taskStartTimes.get(taskId) || Date.now();
		const history = this.iterationHistory.get(agentId) || [];
		const checkpoints = this.taskCheckpoints.get(taskId) || [];
		const llmCalls = this.taskLlmCalls.get(taskId) || [];

		const loopResult = this.detectLoop(agentId);
		const totalCost = llmCalls.reduce((sum, c) => sum + (c.cost ?? 0), 0);
		const recentProgress = history.slice(-5).map((i) => i.progressSignal || 'lateral');

		return {
			iterationsCompleted: history.length,
			costSoFar: totalCost,
			timeElapsedMs: Date.now() - startTime,
			isStuck: loopResult.isLooping,
			recentProgress: recentProgress as ProgressSignal[],
			checkpointsPassed: checkpoints.filter((c) => c.status === 'passed').length,
			checkpointsFailed: checkpoints.filter((c) => c.status === 'failed').length,
		};
	}

	/**
	 * Clears metrics data for a task (after evaluation is persisted)
	 */
	clearTask(taskId: string, agentId: string): void {
		this.taskStartTimes.delete(taskId);
		this.taskLlmCalls.delete(taskId);
		this.taskCheckpoints.delete(taskId);
		this.iterationHistory.delete(agentId);
	}

	private aggregateLlmCalls(calls: LlmCall[]): LlmCallMetricsAggregate {
		let totalCost = 0;
		let totalInput = 0;
		let totalOutput = 0;
		let totalCached = 0;
		let totalReasoning = 0;
		let totalTtft = 0;
		let totalTime = 0;
		let extractionFailures = 0;
		let errorCount = 0;
		let totalRetries = 0;
		let ttftCount = 0;
		let timeCount = 0;

		for (const call of calls) {
			totalCost += call.cost ?? 0;
			totalInput += call.inputTokens ?? 0;
			totalOutput += call.outputTokens ?? 0;
			totalCached += call.cachedInputTokens ?? 0;
			totalReasoning += call.reasoningTokens ?? 0;
			totalRetries += call.retryCount ?? 0;

			if (call.timeToFirstToken) {
				totalTtft += call.timeToFirstToken;
				ttftCount++;
			}
			if (call.totalTime) {
				totalTime += call.totalTime;
				timeCount++;
			}
			if (call.extractionSuccess === false) {
				extractionFailures++;
			}
			if (call.error) {
				errorCount++;
			}
		}

		return {
			callCount: calls.length,
			totalCost,
			totalInputTokens: totalInput,
			totalOutputTokens: totalOutput,
			totalCachedTokens: totalCached,
			cacheHitRatio: totalInput > 0 ? totalCached / totalInput : 0,
			totalReasoningTokens: totalReasoning,
			avgTimeToFirstToken: ttftCount > 0 ? totalTtft / ttftCount : 0,
			avgTotalTime: timeCount > 0 ? totalTime / timeCount : 0,
			extractionFailures,
			errorCount,
			totalRetries,
		};
	}

	private analyzeIterationPatterns(history: Partial<AutonomousIteration>[]): IterationPatternSummary {
		const progressDist: Record<ProgressSignal, number> = {
			forward: 0,
			lateral: 0,
			backward: 0,
			stuck: 0,
		};

		const decisionDist: Record<DecisionType, number> = {
			explore: 0,
			implement: 0,
			verify: 0,
			fix: 0,
			refactor: 0,
			other: 0,
		};

		let stuckEpisodes = 0;
		let currentStuckLength = 0;
		let longestStuckSequence = 0;
		let errorRecoveryAttempts = 0;
		let successfulRecoveries = 0;

		for (let i = 0; i < history.length; i++) {
			const iter = history[i];

			// Count progress signals
			if (iter.progressSignal) {
				progressDist[iter.progressSignal]++;
			}

			// Count decision types
			if (iter.decisionType) {
				decisionDist[iter.decisionType]++;
			}

			// Track stuck sequences
			if (iter.progressSignal === 'stuck') {
				currentStuckLength++;
				if (currentStuckLength === 1) {
					stuckEpisodes++;
				}
			} else {
				longestStuckSequence = Math.max(longestStuckSequence, currentStuckLength);
				currentStuckLength = 0;
			}

			// Track error recovery
			if (iter.error) {
				if (i + 1 < history.length) {
					errorRecoveryAttempts++;
					if (!history[i + 1].error) {
						successfulRecoveries++;
					}
				}
			}
		}

		// Final stuck sequence
		longestStuckSequence = Math.max(longestStuckSequence, currentStuckLength);

		return {
			progressSignalDistribution: progressDist,
			decisionTypeDistribution: decisionDist,
			stuckEpisodes,
			longestStuckSequence,
			errorRecoveryAttempts,
			successfulRecoveries,
		};
	}
}

// Singleton instance
let metricsCollector: MetricsCollectorService | null = null;

export function getMetricsCollector(): MetricsCollectorService {
	if (!metricsCollector) {
		metricsCollector = new MetricsCollectorService();
	}
	return metricsCollector;
}
