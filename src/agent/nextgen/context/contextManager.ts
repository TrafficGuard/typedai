/**
 * Context Manager for NextGen Agent
 *
 * Manages the message stack, token budgeting, and cache-optimized message construction.
 * This is the foundation for the NextGen agent's context management strategy.
 */

import type { LLM, LlmMessage } from '#shared/llm/llm.model';
import {
	type CacheOptimizedMessageStack,
	type CompactionConfig,
	type CompactionTrigger,
	DEFAULT_COMPACTION_CONFIG,
	type NextGenAgentContext,
	type TokenBudget,
} from '../core/types';

/**
 * Configuration for the ContextManager
 */
export interface ContextManagerConfig {
	/** Maximum tokens for the model (default: 128000) */
	maxTokens?: number;
	/** Tokens to reserve for response (default: 4000) */
	responseReserve?: number;
	/** Compaction configuration */
	compactionConfig?: Partial<CompactionConfig>;
}

/**
 * Manages context lifecycle, token budgeting, and message construction
 * for NextGen agents.
 */
export class ContextManager {
	private config: Required<ContextManagerConfig>;
	private compactionConfig: CompactionConfig;

	constructor(config: ContextManagerConfig = {}) {
		this.config = {
			maxTokens: config.maxTokens ?? 128000,
			responseReserve: config.responseReserve ?? 4000,
			compactionConfig: config.compactionConfig ?? {},
		};
		this.compactionConfig = {
			...DEFAULT_COMPACTION_CONFIG,
			...config.compactionConfig,
		};
	}

	/**
	 * Builds a flat message array from the agent's message stack
	 * This is the primary method for constructing the LLM prompt.
	 */
	buildPrompt(agent: NextGenAgentContext): LlmMessage[] {
		const stack = agent.messageStack;
		const messages: LlmMessage[] = [];

		// TIER 1: Stable prefix (cached)
		messages.push(stack.systemMessage);
		messages.push(stack.repositoryContext);

		// Add acknowledgment message if we have task
		if (stack.taskMessage) {
			// Insert acknowledgment before task for caching
			messages.push({ role: 'assistant', content: 'I understand the repository structure. What is the task?', cache: 'ephemeral' });
			messages.push(stack.taskMessage);
		}

		// TIER 2: Compacted context (cached after compaction)
		if (stack.compactedContext) {
			messages.push(stack.compactedContext);
		}

		// TIER 3: Dynamic tool schemas
		for (const schema of stack.toolSchemas) {
			messages.push(schema);
		}

		// TIER 4: Recent conversation history
		for (const msg of stack.recentHistory) {
			messages.push(msg);
		}

		// TIER 5: Current iteration (never cached)
		if (stack.currentIteration) {
			messages.push(stack.currentIteration);
		}

		// Prune ephemeral cache markers to prevent fragmentation
		this.pruneEphemeralCache(messages, this.compactionConfig.maxEphemeralMarkers);

		return messages;
	}

	/**
	 * Calculates the current token budget allocation
	 */
	async calculateTokenBudget(agent: NextGenAgentContext, llm: LLM): Promise<TokenBudget> {
		const messages = this.buildPrompt(agent);
		const stack = agent.messageStack;

		// Calculate tokens for each section
		const systemPromptTokens = await this.countMessageTokens([stack.systemMessage], llm);
		const repoContextTokens = await this.countMessageTokens([stack.repositoryContext], llm);
		const taskTokens = stack.taskMessage ? await this.countMessageTokens([stack.taskMessage], llm) : 0;
		const toolSchemaTokens = await this.countMessageTokens(stack.toolSchemas, llm);
		const compactedHistoryTokens = stack.compactedContext ? await this.countMessageTokens([stack.compactedContext], llm) : 0;
		const recentConversationTokens = await this.countMessageTokens(stack.recentHistory, llm);

		// Calculate LiveFiles tokens from state
		let liveFilesTokens = 0;
		for (const file of agent.liveFilesState.files.values()) {
			liveFilesTokens += file.tokens;
		}

		const currentUsed =
			systemPromptTokens + repoContextTokens + taskTokens + toolSchemaTokens + compactedHistoryTokens + recentConversationTokens + liveFilesTokens;

		const available = this.config.maxTokens - currentUsed - this.config.responseReserve;

		return {
			maxTokens: this.config.maxTokens,
			systemPromptTokens: systemPromptTokens + repoContextTokens + taskTokens,
			toolSchemaTokens,
			liveFilesTokens,
			compactedHistoryTokens,
			recentConversationTokens,
			responseReserve: this.config.responseReserve,
			currentUsed,
			available,
		};
	}

	/**
	 * Determines if the agent context should be compacted
	 */
	async shouldCompact(agent: NextGenAgentContext, llm: LLM): Promise<{ should: boolean; trigger?: CompactionTrigger }> {
		// Check for sub-task completion marker in recent history
		const lastMessage = agent.messageStack.recentHistory.at(-1);
		if (lastMessage && typeof lastMessage.content === 'string') {
			if (lastMessage.content.includes('<subtask_complete>')) {
				return { should: true, trigger: 'subtask_complete' };
			}
		}

		// Check iteration threshold
		const iterationsSinceCompaction = agent.iterations - agent.lastCompactionIteration;
		if (iterationsSinceCompaction >= this.compactionConfig.iterationThreshold) {
			return { should: true, trigger: 'iteration_threshold' };
		}

		// Check token threshold
		const budget = await this.calculateTokenBudget(agent, llm);
		const usagePercent = budget.currentUsed / budget.maxTokens;
		if (usagePercent >= this.compactionConfig.tokenThresholdPercent) {
			return { should: true, trigger: 'token_threshold' };
		}

		return { should: false };
	}

	/**
	 * Adds a message to the recent history
	 */
	addToHistory(agent: NextGenAgentContext, message: LlmMessage): void {
		agent.messageStack.recentHistory.push(message);
	}

	/**
	 * Sets the current iteration message
	 */
	setCurrentIteration(agent: NextGenAgentContext, message: LlmMessage): void {
		agent.messageStack.currentIteration = message;
	}

	/**
	 * Clears the current iteration (call after LLM response)
	 */
	clearCurrentIteration(agent: NextGenAgentContext): void {
		agent.messageStack.currentIteration = undefined;
	}

	/**
	 * Adds a tool schema message when a tool group is loaded
	 */
	addToolSchema(agent: NextGenAgentContext, groupName: string, schemaContent: string): void {
		const schemaMessage: LlmMessage = {
			role: 'user',
			content: `<loaded_tool_group name="${groupName}">\n${schemaContent}\n</loaded_tool_group>`,
		};
		agent.messageStack.toolSchemas.push(schemaMessage);
		agent.toolLoadingState.activeGroups.add(groupName);
		agent.toolLoadingState.groupsUsedSinceLastCompaction.add(groupName);
		agent.toolLoadingState.loadedAt.set(groupName, Date.now());
	}

	/**
	 * Removes tool schemas for specified groups (used during compaction)
	 */
	removeToolSchemas(agent: NextGenAgentContext, groupNames: string[]): void {
		const groupSet = new Set(groupNames);
		agent.messageStack.toolSchemas = agent.messageStack.toolSchemas.filter((msg) => {
			if (typeof msg.content !== 'string') return true;
			const match = msg.content.match(/<loaded_tool_group name="([^"]+)">/);
			if (!match) return true;
			return !groupSet.has(match[1]);
		});

		for (const group of groupNames) {
			agent.toolLoadingState.activeGroups.delete(group);
			agent.toolLoadingState.loadedAt.delete(group);
		}
	}

	/**
	 * Sets the compacted context message after compaction
	 */
	setCompactedContext(agent: NextGenAgentContext, summary: string, iterationRange: { start: number; end: number }): void {
		const content = `<compacted_work iterations="${iterationRange.start}-${iterationRange.end}">\n${summary}\n</compacted_work>`;

		agent.messageStack.compactedContext = {
			role: 'user',
			content,
			cache: 'ephemeral',
		};

		agent.compactedSummaries.push(summary);
	}

	/**
	 * Trims recent history to preserve only the specified number of turns
	 */
	trimRecentHistory(agent: NextGenAgentContext, turnsToPreserve?: number): LlmMessage[] {
		const preserve = turnsToPreserve ?? this.compactionConfig.recentTurnsToPreserve;
		const history = agent.messageStack.recentHistory;

		// Calculate how many messages to keep (each turn is typically 2 messages: assistant + user)
		const messagesToKeep = preserve * 2;

		if (history.length <= messagesToKeep) {
			return []; // Nothing to trim
		}

		const trimmed = history.splice(0, history.length - messagesToKeep);
		return trimmed;
	}

	/**
	 * Initializes the message stack for a new agent
	 */
	initializeMessageStack(systemPrompt: string, repositoryOverview: string, task: string): CacheOptimizedMessageStack {
		return {
			systemMessage: {
				role: 'system',
				content: systemPrompt,
				cache: 'ephemeral',
			},
			repositoryContext: {
				role: 'user',
				content: repositoryOverview,
				cache: 'ephemeral',
			},
			taskMessage: {
				role: 'user',
				content: `<task>\n${task}\n</task>`,
				cache: 'ephemeral',
			},
			toolSchemas: [],
			recentHistory: [],
		};
	}

	/**
	 * Prunes ephemeral cache markers to prevent cache fragmentation.
	 * Keeps only the most recent N markers, preserving the stable prefix.
	 */
	private pruneEphemeralCache(messages: LlmMessage[], maxEphemeral: number): void {
		const ephemeralIdxs: number[] = [];

		for (let i = 0; i < messages.length; i++) {
			if (messages[i].cache === 'ephemeral') {
				ephemeralIdxs.push(i);
			}
		}

		// Keep the first 4 (system, repo, acknowledgment, task) always cached
		// Prune older dynamic cache markers
		while (ephemeralIdxs.length > maxEphemeral) {
			const idxToClear = ephemeralIdxs.find((i) => i > 3);
			if (idxToClear !== undefined) {
				messages[idxToClear].cache = undefined;
				ephemeralIdxs.splice(ephemeralIdxs.indexOf(idxToClear), 1);
			} else {
				break;
			}
		}
	}

	/**
	 * Helper to count tokens in messages
	 */
	private async countMessageTokens(messages: LlmMessage[], llm: LLM): Promise<number> {
		if (messages.length === 0) return 0;

		let totalChars = 0;
		for (const msg of messages) {
			if (typeof msg.content === 'string') {
				totalChars += msg.content.length;
			} else {
				for (const part of msg.content) {
					if ('text' in part) {
						totalChars += part.text.length;
					}
				}
			}
		}

		// Use LLM's token counter if available, otherwise estimate
		if ('countTokens' in llm && typeof llm.countTokens === 'function') {
			try {
				const text = messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
				return await llm.countTokens(text);
			} catch {
				// Fall back to estimation
			}
		}

		// Rough estimate: 4 chars = 1 token
		return Math.ceil(totalChars / 4);
	}

	/**
	 * Gets the compaction configuration
	 */
	getCompactionConfig(): CompactionConfig {
		return { ...this.compactionConfig };
	}
}
