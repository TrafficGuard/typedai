/**
 * Agent Runtime for NextGen Agent
 *
 * The core execution loop that ties together all components:
 * - ContextManager for message stack management
 * - CompactionService for smart context compression
 * - ToolLoader for dynamic tool loading
 * - LearningExtractor for capturing insights
 * - SubAgentOrchestrator for spawning sub-agents
 */

import { randomUUID } from 'node:crypto';
import { logger } from '#o11y/logger';
import type { AgentLLMs, LlmFunctions } from '#shared/agent/agent.model';
import type { LLM } from '#shared/llm/llm.model';
import type { LlmMessage } from '#shared/llm/llm.model';
import { CompactionService, type CompactionServiceConfig } from '../context/compactionService';
import { ContextManager, type ContextManagerConfig } from '../context/contextManager';
import { KnowledgeBase, type KnowledgeBaseConfig } from '../learning/knowledgeBase';
import { LearningExtractor, type LearningExtractorConfig } from '../learning/learningExtractor';
import { type OrchestratorConfig, SubAgentOrchestrator } from '../subagent/subAgentOrchestrator';
import { ToolLoader, type ToolLoaderConfig } from '../tools/toolLoader';
import type {
	CompactionResult,
	CompactionTrigger,
	DEFAULT_COMPACTION_CONFIG,
	Learning,
	NextGenAgentConfig,
	NextGenAgentContext,
	SubAgentResult,
} from './types';
import { HITL_REVIEW_STATE } from '../subtask/subtaskManager';

/**
 * Configuration for the agent runtime
 */
export interface AgentRuntimeConfig {
	/** Context manager configuration */
	contextManager?: ContextManagerConfig;
	/** Compaction service configuration */
	compactionService?: CompactionServiceConfig;
	/** Tool loader configuration */
	toolLoader?: ToolLoaderConfig;
	/** Learning extractor configuration */
	learningExtractor?: LearningExtractorConfig;
	/** Knowledge base configuration */
	knowledgeBase?: KnowledgeBaseConfig;
	/** Sub-agent orchestrator configuration */
	orchestrator?: OrchestratorConfig;
	/** Maximum iterations before stopping (default: 50) */
	maxIterations?: number;
	/** Budget limit in USD (default: 10.0) */
	maxBudget?: number;
	/** Whether to save learnings on completion (default: true) */
	saveLearnings?: boolean;
}

/**
 * Result of an agent run
 */
export interface AgentRunResult {
	/** Final state */
	state: 'completed' | 'error' | 'max_iterations' | 'budget_exceeded' | 'cancelled' | 'hitl_review';
	/** Final output from the agent */
	output: string;
	/** Total iterations executed */
	iterations: number;
	/** Total cost incurred */
	cost: number;
	/** Number of compactions performed */
	compactionCount: number;
	/** Learnings extracted during the run */
	learnings: Learning[];
	/** Sub-agent results */
	subAgentResults: SubAgentResult[];
	/** Error message if state is 'error' */
	error?: string;
}

/**
 * Callback for iteration events
 */
export type IterationCallback = (iteration: number, context: NextGenAgentContext) => void | Promise<void>;

/**
 * The core runtime for NextGen agents
 */
export class AgentRuntime {
	private config: Required<AgentRuntimeConfig>;
	private contextManager: ContextManager;
	private compactionService: CompactionService;
	private toolLoader: ToolLoader;
	private learningExtractor: LearningExtractor;
	private knowledgeBase: KnowledgeBase;
	private orchestrator: SubAgentOrchestrator;

	private cancelled = false;

	constructor(config: AgentRuntimeConfig = {}) {
		this.config = {
			contextManager: config.contextManager ?? {},
			compactionService: config.compactionService ?? {},
			toolLoader: config.toolLoader ?? {},
			learningExtractor: config.learningExtractor ?? {},
			knowledgeBase: config.knowledgeBase ?? {},
			orchestrator: config.orchestrator ?? {},
			maxIterations: config.maxIterations ?? 50,
			maxBudget: config.maxBudget ?? 10.0,
			saveLearnings: config.saveLearnings ?? true,
		};

		// Initialize components
		this.contextManager = new ContextManager(this.config.contextManager);
		this.toolLoader = new ToolLoader(this.config.toolLoader, this.contextManager);
		this.compactionService = new CompactionService(this.config.compactionService);
		this.learningExtractor = new LearningExtractor(this.config.learningExtractor);
		this.knowledgeBase = new KnowledgeBase(this.config.knowledgeBase);
		this.orchestrator = new SubAgentOrchestrator(this.config.orchestrator);

		// Configure orchestrator callbacks
		this.orchestrator.setContextFactory(this.createSubAgentContext.bind(this));
		this.orchestrator.setExecutor(this.executeSubAgent.bind(this));
	}

	/**
	 * Creates a new agent context
	 */
	async createContext(agentConfig: NextGenAgentConfig): Promise<NextGenAgentContext> {
		const agentId = randomUUID();

		// Initialize message stack with proper arguments
		// (systemPrompt, repositoryOverview, task)
		const systemPrompt = `You are ${agentConfig.name}, an AI assistant.`;
		const repositoryOverview = agentConfig.projectPath ? `Project: ${agentConfig.projectPath}` : '';
		const messageStack = this.contextManager.initializeMessageStack(systemPrompt, repositoryOverview, agentConfig.prompt);

		// Initialize tool loading state
		const toolLoadingState = this.toolLoader.initializeToolState();

		const context: NextGenAgentContext = {
			// Base AgentContext properties
			agentId,
			type: 'autonomous',
			subtype: 'nextgen',
			executionId: randomUUID(),
			typedAiRepoDir: process.cwd(),
			traceId: '',
			name: agentConfig.name,
			user: { id: '', email: '' } as any, // Will be set based on auth
			inputPrompt: agentConfig.prompt,
			userPrompt: agentConfig.prompt,
			state: 'agent',
			iterations: 0,
			maxIterations: agentConfig.maxIterations ?? this.config.maxIterations,
			hilBudget: agentConfig.budget ?? this.config.maxBudget,
			budgetRemaining: agentConfig.budget ?? this.config.maxBudget,
			cost: 0,
			llms: agentConfig.llms,
			functions: agentConfig.functions,
			fileSystem: null,
			useSharedRepos: true,
			memory: agentConfig.initialMemory ?? {},
			lastUpdate: Date.now(),
			createdAt: Date.now(),
			metadata: {},
			pendingMessages: [],
			invoking: [],
			notes: [],
			functionCallHistory: [],
			hilCount: 0,
			callStack: [],
			error: undefined,

			// NextGen extensions
			messageStack,
			messages: [],
			compactionConfig: { ...this.contextManager.getCompactionConfig(), ...agentConfig.compactionConfig },
			lastCompactionIteration: 0,
			compactedSummaries: [],
			toolLoadingState,
			liveFilesState: {
				files: new Map(),
				maxTokens: 10000,
				useDiffMarkers: true,
				useHashReferences: true,
			},
			activeSubAgents: new Map(),
			completedSubAgentResults: [],
			sessionLearnings: [],
			retrievedLearnings: [],
			structuredMemory: {},
			parentAgentId: agentConfig.parentAgentId,
		};

		// Retrieve relevant learnings for this task
		await this.retrieveRelevantLearnings(context);

		return context;
	}

	/**
	 * Runs the agent to completion
	 */
	async run(context: NextGenAgentContext, llm: LLM, onIteration?: IterationCallback): Promise<AgentRunResult> {
		this.cancelled = false;
		let compactionCount = 0;
		let lastOutput = '';

		try {
			while (!this.shouldStop(context)) {
				if (this.cancelled) {
					return this.createResult(context, 'cancelled', lastOutput, compactionCount);
				}

				// Build the prompt
				const messages = this.contextManager.buildPrompt(context);
				context.messages = messages;

				// Check if compaction is needed before LLM call
				const { should: shouldCompact, trigger: compactionTrigger } = await this.contextManager.shouldCompact(context, llm);
				if (shouldCompact && compactionTrigger) {
					const compactionResult = await this.performCompaction(context, compactionTrigger, llm);
					compactionCount++;
					logger.info(`Compaction completed: ${compactionResult.tokensSaved} tokens saved`);

					// Rebuild messages after compaction
					context.messages = this.contextManager.buildPrompt(context);
				}

				// Call LLM
				context.iterations++;
				const response = await this.callLLM(context, llm);

				// Process response
				const { output, isComplete, error } = await this.processResponse(context, response);
				lastOutput = output;

				// Call iteration callback
				if (onIteration) {
					await onIteration(context.iterations, context);
				}

				// Check for completion
				if (isComplete) {
					return this.createResult(context, 'completed', output, compactionCount);
				}

				// Check for errors
				if (error) {
					return this.createResult(context, 'error', output, compactionCount, error);
				}

				// Check for human-in-the-loop review state (subtask review requested)
				if (context.state === HITL_REVIEW_STATE) {
					logger.info({ iterations: context.iterations }, 'Agent paused for human-in-the-loop review');
					return this.createResult(context, 'hitl_review', output, compactionCount);
				}

				// Add response to history
				this.contextManager.addToHistory(context, {
					role: 'assistant',
					content: output,
				});
			}

			// Determine why we stopped
			const stopReason = this.getStopReason(context);
			return this.createResult(context, stopReason, lastOutput, compactionCount);
		} catch (error) {
			logger.error(error, 'Agent runtime error');
			return this.createResult(context, 'error', lastOutput, compactionCount, (error as Error).message);
		} finally {
			// Save learnings on completion if configured
			if (this.config.saveLearnings && context.sessionLearnings.length > 0) {
				await this.saveLearnings(context);
			}
		}
	}

	/**
	 * Cancels the running agent
	 */
	cancel(): void {
		this.cancelled = true;
		logger.info('Agent runtime cancellation requested');
	}

	/**
	 * Resumes an agent from hitl_review state after human review decision
	 */
	async resumeFromReview(
		context: NextGenAgentContext,
		llm: LLM,
		decision: 'approved' | 'changes_requested' | 'aborted',
		feedback?: string,
		onIteration?: IterationCallback,
	): Promise<AgentRunResult> {
		// Import dynamically to avoid circular dependency
		const { handleReviewDecision } = await import('../subtask/subtaskManager.js');

		// Handle the review decision
		const { continueExecution, message } = await handleReviewDecision(context, decision, feedback);

		if (!continueExecution) {
			// Task is done (e.g., aborted with no more work)
			return this.createResult(context, 'completed', message, 0);
		}

		// Add the review result message to history
		this.contextManager.addToHistory(context, {
			role: 'user',
			content: `[Review Decision]\n${message}`,
		});

		// Continue running the agent
		return this.run(context, llm, onIteration);
	}

	/**
	 * Gets the runtime configuration
	 */
	getConfig(): Required<AgentRuntimeConfig> {
		return { ...this.config };
	}

	/**
	 * Gets the context manager
	 */
	getContextManager(): ContextManager {
		return this.contextManager;
	}

	/**
	 * Gets the tool loader
	 */
	getToolLoader(): ToolLoader {
		return this.toolLoader;
	}

	/**
	 * Gets the compaction service
	 */
	getCompactionService(): CompactionService {
		return this.compactionService;
	}

	/**
	 * Gets the knowledge base
	 */
	getKnowledgeBase(): KnowledgeBase {
		return this.knowledgeBase;
	}

	/**
	 * Gets the sub-agent orchestrator
	 */
	getOrchestrator(): SubAgentOrchestrator {
		return this.orchestrator;
	}

	// Private methods

	private shouldStop(context: NextGenAgentContext): boolean {
		if (context.iterations >= context.maxIterations) {
			return true;
		}
		if (context.budgetRemaining !== undefined && context.budgetRemaining <= 0) {
			return true;
		}
		return false;
	}

	private getStopReason(context: NextGenAgentContext): 'max_iterations' | 'budget_exceeded' {
		if (context.iterations >= context.maxIterations) {
			return 'max_iterations';
		}
		return 'budget_exceeded';
	}

	private async callLLM(context: NextGenAgentContext, llm: LLM): Promise<string> {
		const response = await llm.generateText(context.messages, { id: `iteration-${context.iterations}` });
		return response;
	}

	private async processResponse(context: NextGenAgentContext, response: string): Promise<{ output: string; isComplete: boolean; error?: string }> {
		// Check for completion marker
		if (response.includes('<completed>') || response.includes('completed()')) {
			return { output: response, isComplete: true };
		}

		// Check for function calls
		const functionCallMatch = response.match(/<function_call>\s*([\s\S]*?)\s*<\/function_call>/);
		if (functionCallMatch) {
			try {
				const functionResult = await this.executeFunctionCall(context, functionCallMatch[1]);
				return { output: functionResult, isComplete: false };
			} catch (error) {
				return {
					output: response,
					isComplete: false,
					error: `Function call error: ${(error as Error).message}`,
				};
			}
		}

		// Regular response - add to history
		return { output: response, isComplete: false };
	}

	private async executeFunctionCall(context: NextGenAgentContext, callContent: string): Promise<string> {
		// Parse function call
		// This is a simplified implementation - real implementation would use the function registry
		const funcMatch = callContent.match(/(\w+)\(([\s\S]*)\)/);
		if (!funcMatch) {
			return `Error: Invalid function call format: ${callContent}`;
		}

		const [, funcName, argsStr] = funcMatch;

		// Handle special agent functions
		if (funcName === 'Agent_loadToolGroup') {
			const groupName = argsStr.replace(/['"]/g, '').trim();
			const result = await this.toolLoader.loadGroup(context, groupName);
			return result.success ? `Loaded tool group: ${groupName}` : `Failed to load tool group: ${result.error}`;
		}

		if (funcName === 'completed') {
			return 'Task completed';
		}

		// Execute through function registry
		// This would call the actual function implementation
		return `Function ${funcName} executed`;
	}

	private async performCompaction(context: NextGenAgentContext, trigger: CompactionTrigger, _llm: LLM): Promise<CompactionResult> {
		logger.info(`Performing compaction triggered by: ${trigger}`);

		const result = await this.compactionService.compact(context, trigger, context.llms);

		return result;
	}

	private async retrieveRelevantLearnings(context: NextGenAgentContext): Promise<void> {
		try {
			await this.knowledgeBase.initialize();
			const learnings = await this.knowledgeBase.retrieveRelevant(context.inputPrompt);
			context.retrievedLearnings = learnings;

			if (learnings.length > 0) {
				logger.info(`Retrieved ${learnings.length} relevant learnings for task`);
			}
		} catch (error) {
			logger.warn(error, 'Failed to retrieve learnings');
		}
	}

	private async saveLearnings(context: NextGenAgentContext): Promise<void> {
		try {
			await this.knowledgeBase.initialize();
			await this.knowledgeBase.saveAll(context.sessionLearnings);
			logger.info(`Saved ${context.sessionLearnings.length} learnings`);
		} catch (error) {
			logger.warn(error, 'Failed to save learnings');
		}
	}

	private async createSubAgentContext(
		parent: NextGenAgentContext,
		config: { name: string; role: string; llmLevel: string },
		task: string,
	): Promise<NextGenAgentContext> {
		return this.createContext({
			name: config.name,
			prompt: task,
			llms: parent.llms,
			functions: parent.functions,
			parentAgentId: parent.agentId,
			projectPath: parent.metadata.projectPath as string | undefined,
		});
	}

	private async executeSubAgent(context: NextGenAgentContext): Promise<SubAgentResult> {
		const llm = context.llms.medium;
		const result = await this.run(context, llm);

		return {
			agentId: context.agentId,
			name: context.name,
			output: result.output,
			state: result.state === 'completed' ? 'completed' : 'error',
			error: result.error,
			cost: result.cost,
			iterations: result.iterations,
		};
	}

	private createResult(context: NextGenAgentContext, state: AgentRunResult['state'], output: string, compactionCount: number, error?: string): AgentRunResult {
		return {
			state,
			output,
			iterations: context.iterations,
			cost: context.cost ?? 0,
			compactionCount,
			learnings: context.sessionLearnings,
			subAgentResults: context.completedSubAgentResults,
			error,
		};
	}
}

/**
 * Creates and runs a NextGen agent
 */
export async function runNextGenAgent(config: NextGenAgentConfig, llm: LLM, runtimeConfig?: AgentRuntimeConfig): Promise<AgentRunResult> {
	const runtime = new AgentRuntime(runtimeConfig);
	const context = await runtime.createContext(config);
	return runtime.run(context, llm);
}
