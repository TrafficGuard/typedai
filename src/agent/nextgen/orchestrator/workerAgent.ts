/**
 * Worker Agent
 *
 * Executes a single feature with context hydrated from domain memory.
 * After implementation, runs the test command and updates status.
 *
 * Tools: Full code tools + TodoWrite
 * Input: context.md (generated from domain memory)
 * Output: Code changes, test results → status.json, progress.md
 */

import type { AgentLLMs } from '#shared/agent/agent.model';
import { extractAssistantText, isResultMessage, isSuccessResult, unstable_v2_createSession } from '../agentSdk.js';
import type { KnowledgeBase } from '../learning/knowledgeBase';
import {
	createWorkerInitialPrompt,
	getDomainMemoryPaths,
	getGoalTree,
	getTaskStatus,
	initializeWorkerSession,
	logFeatureAttempt,
	logFeatureFailed,
	logFeaturePassed,
	recalculateMilestoneStatus,
	runFeatureTest,
	setTaskStatus,
	startFeature,
	updateFeatureStatusFromTest,
} from '../memory/index.js';
import type {
	DecisionSummary,
	DesignDecisionSummary,
	DomainMemoryPaths,
	Feature,
	GoalTree,
	Learning,
	RelevantFile,
	ReviewHistorySummary,
	SessionContext,
	TaskStatus,
	TestResult,
} from '../memory/types.js';

// =============================================================================
// Types
// =============================================================================

export interface WorkerAgentConfig {
	llms: AgentLLMs;
	knowledgeBase?: KnowledgeBase;
	workingDirectory: string;
	taskId: string;
	maxIterations?: number;
	maxCost?: number;
}

export interface WorkerAgentResult {
	success: boolean;
	feature: Feature;
	testResult: TestResult;
	filesChanged: string[];
	commits: string[];
	cost: number;
	iterations: number;
	error?: string;
}

export interface WorkerAgentOptions {
	/** Discover relevant files for the feature */
	discoverFiles?: (description: string) => Promise<RelevantFile[]>;
	/** Get KB learnings for the feature */
	getLearnings?: (description: string, filePaths: string[]) => Promise<Learning[]>;
	/** Recent decisions from orchestrator */
	recentDecisions?: DecisionSummary[];
	/** Review history for the feature */
	reviewHistory?: ReviewHistorySummary[];
	/** Binding design decisions from previous reviews */
	bindingDesignDecisions?: DesignDecisionSummary[];
}

// =============================================================================
// Worker Agent
// =============================================================================

/**
 * Run the worker agent to implement a single feature.
 */
export async function runWorkerAgent(config: WorkerAgentConfig, options: WorkerAgentOptions = {}): Promise<WorkerAgentResult> {
	const paths = getDomainMemoryPaths(config.workingDirectory, config.taskId);
	const maxIterations = config.maxIterations ?? 20;
	const maxCost = config.maxCost ?? 5.0;

	// 1. Initialize session from domain memory
	const initResult = await initializeWorkerSession(paths, {
		discoverFiles: options.discoverFiles,
		getLearnings: options.getLearnings,
		recentDecisions: options.recentDecisions,
		reviewHistory: options.reviewHistory,
		bindingDesignDecisions: options.bindingDesignDecisions,
	});

	if (initResult.type !== 'success') {
		throw new Error(initResult.type === 'complete' ? 'Task is already complete' : `Session blocked: ${initResult.details}`);
	}

	const { context } = initResult;
	const feature = context.currentFeature;

	// 2. Mark feature as in_progress
	let status = await getTaskStatus(paths);
	if (status) {
		status = startFeature(status, feature.id);
		await setTaskStatus(paths, status);
	}

	// 3. Log the attempt
	const goals = await getGoalTree(paths);
	if (goals) {
		await logFeatureAttempt(paths, feature, 'Starting implementation', context.featureStatus.attempts + 1);
	}

	// 4. Run the implementation session
	const implementationResult = await runImplementationSession(config, context, maxIterations, maxCost);

	// 5. Run the test command
	const testResult = await runFeatureTest(feature, config.workingDirectory);

	// 6. Update status based on test result
	status = await getTaskStatus(paths);
	if (status && goals) {
		status = updateFeatureStatusFromTest(status, feature.id, testResult, implementationResult.commits);
		status = recalculateMilestoneStatus(status, goals);
		await setTaskStatus(paths, status);

		// 7. Log the result
		if (testResult.passed) {
			await logFeaturePassed(paths, feature, testResult, implementationResult.filesChanged, implementationResult.commits);
		} else {
			await logFeatureFailed(paths, feature, testResult, context.featureStatus.attempts + 1);
		}
	}

	return {
		success: testResult.passed,
		feature,
		testResult,
		filesChanged: implementationResult.filesChanged,
		commits: implementationResult.commits,
		cost: implementationResult.cost,
		iterations: implementationResult.iterations,
		error: testResult.passed ? undefined : testResult.error,
	};
}

// =============================================================================
// Implementation Session
// =============================================================================

interface ImplementationResult {
	filesChanged: string[];
	commits: string[];
	cost: number;
	iterations: number;
}

async function runImplementationSession(
	config: WorkerAgentConfig,
	context: SessionContext,
	maxIterations: number,
	maxCost: number,
): Promise<ImplementationResult> {
	let cost = 0;
	let iterations = 0;
	const filesChanged: string[] = [];
	const commits: string[] = [];

	// Create the initial prompt
	const initialPrompt = createWorkerInitialPrompt(context);

	// Build system prompt addition
	const systemPromptAddition = buildSystemPromptAddition(context);

	// Create session
	const session = await unstable_v2_createSession({
		model: config.llms.medium.getModel(),
		cwd: config.workingDirectory,
		permissionMode: 'acceptEdits', // Allow code changes
		systemPrompt: systemPromptAddition,
	});

	try {
		// Send initial message
		await session.send(initialPrompt);

		// Process responses
		for await (const message of session.receive()) {
			iterations++;

			// Track cost (approximate)
			if ('usage' in message) {
				const usage = (message as any).usage;
				if (usage) {
					cost += (usage.input_tokens || 0) * 0.000003 + (usage.output_tokens || 0) * 0.000015;
				}
			}

			// Check for completion
			if (isResultMessage(message) && isSuccessResult(message)) {
				break;
			}

			// Check limits
			if (iterations >= maxIterations) {
				console.warn(`Worker agent hit max iterations (${maxIterations})`);
				break;
			}

			if (cost >= maxCost) {
				console.warn(`Worker agent hit max cost ($${maxCost})`);
				break;
			}
		}

		// Get files changed and commits (would integrate with git)
		// For now, return empty arrays - actual implementation would track these

		return {
			filesChanged,
			commits,
			cost,
			iterations,
		};
	} finally {
		await session.close();
	}
}

function buildSystemPromptAddition(context: SessionContext): string {
	const lines: string[] = [];

	lines.push('# Feature Implementation Context');
	lines.push('');
	lines.push(`You are implementing a specific feature for the task: ${context.taskDescription}`);
	lines.push('');
	lines.push('## Current Feature');
	lines.push(`- ID: ${context.currentFeature.id}`);
	lines.push(`- Description: ${context.currentFeature.description}`);
	lines.push(`- Test Command: \`${context.currentFeature.testCommand}\``);
	lines.push('');

	if (context.featureStatus.attempts > 0) {
		lines.push(`## Previous Attempts: ${context.featureStatus.attempts}`);
		if (context.featureStatus.lastError) {
			lines.push(`Last Error: ${context.featureStatus.lastError}`);
		}
		lines.push('');
	}

	if (context.bindingDesignDecisions.length > 0) {
		lines.push('## BINDING Design Decisions (MUST follow)');
		for (const d of context.bindingDesignDecisions) {
			lines.push(`- **${d.category}:** ${d.decision}`);
		}
		lines.push('');
	}

	lines.push('## Instructions');
	lines.push('1. Implement the feature as described');
	lines.push('2. Follow any binding design decisions above');
	lines.push('3. The test command will be run after you complete to verify');
	lines.push('4. Focus on making the tests pass');
	lines.push('');

	return lines.join('\n');
}

// =============================================================================
// Worker Loop
// =============================================================================

/**
 * Run the worker agent in a loop until all features are complete.
 */
export async function runWorkerLoop(config: WorkerAgentConfig, options: WorkerAgentOptions = {}): Promise<WorkerLoopResult> {
	const results: WorkerAgentResult[] = [];
	let totalCost = 0;
	let totalIterations = 0;
	let completedFeatures = 0;
	let failedFeatures = 0;

	const paths = getDomainMemoryPaths(config.workingDirectory, config.taskId);

	while (true) {
		// Check if there's work to do
		const initResult = await initializeWorkerSession(paths, options);

		if (initResult.type === 'complete') {
			// All features passing
			break;
		}

		if (initResult.type === 'blocked') {
			// Blocked, need human intervention
			return {
				completed: false,
				reason: initResult.reason,
				details: initResult.details,
				results,
				totalCost,
				totalIterations,
				completedFeatures,
				failedFeatures,
			};
		}

		// Run worker on next feature
		try {
			const result = await runWorkerAgent(config, options);
			results.push(result);
			totalCost += result.cost;
			totalIterations += result.iterations;

			if (result.success) {
				completedFeatures++;
			} else {
				failedFeatures++;
			}
		} catch (error) {
			// Worker failed unexpectedly
			return {
				completed: false,
				reason: 'error',
				details: error instanceof Error ? error.message : 'Unknown error',
				results,
				totalCost,
				totalIterations,
				completedFeatures,
				failedFeatures,
			};
		}
	}

	return {
		completed: true,
		results,
		totalCost,
		totalIterations,
		completedFeatures,
		failedFeatures,
	};
}

export interface WorkerLoopResult {
	completed: boolean;
	reason?: string;
	details?: string;
	results: WorkerAgentResult[];
	totalCost: number;
	totalIterations: number;
	completedFeatures: number;
	failedFeatures: number;
}
