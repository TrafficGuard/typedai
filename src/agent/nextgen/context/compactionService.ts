/**
 * Compaction Service for NextGen Agent
 *
 * Handles smart context compaction when sub-tasks complete, token thresholds are exceeded,
 * or iteration thresholds are reached. Uses LLM to summarize completed work and extract
 * key decisions while preserving essential context.
 */

import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { LLM, LlmMessage } from '#shared/llm/llm.model';
import {
	type CompactionConfig,
	type CompactionResult,
	type CompactionTrigger,
	DEFAULT_COMPACTION_CONFIG,
	type Learning,
	type NextGenAgentContext,
} from '../core/types';
import { ContextManager } from './contextManager';

/**
 * Extracts JSON from LLM response that may contain <json></json> tags or markdown code blocks
 */
function extractJson<T>(response: string): T {
	// Try to extract from <json></json> tags first
	const jsonTagMatch = response.match(/<json>([\s\S]*?)<\/json>/);
	if (jsonTagMatch) {
		return JSON.parse(jsonTagMatch[1].trim());
	}

	// Try markdown code blocks
	const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (codeBlockMatch) {
		return JSON.parse(codeBlockMatch[1].trim());
	}

	// Try parsing the whole response
	return JSON.parse(response.trim());
}

/**
 * Configuration for the CompactionService
 */
export interface CompactionServiceConfig {
	/** Compaction configuration */
	compactionConfig?: Partial<CompactionConfig>;
	/** LLM to use for summarization (defaults to llms.easy) */
	summarizationLLM?: LLM;
}

/**
 * Service that performs context compaction for NextGen agents.
 * Summarizes completed work, extracts key decisions, and manages tool unloading.
 */
export class CompactionService {
	private config: CompactionConfig;
	private contextManager: ContextManager;

	constructor(config: CompactionServiceConfig = {}) {
		this.config = {
			...DEFAULT_COMPACTION_CONFIG,
			...config.compactionConfig,
		};
		this.contextManager = new ContextManager({
			compactionConfig: this.config,
		});
	}

	/**
	 * Performs context compaction on the agent.
	 *
	 * @param agent - The agent context to compact
	 * @param trigger - What triggered the compaction
	 * @param llms - Agent LLMs for summarization
	 * @returns CompactionResult with details of what was compacted
	 */
	async compact(agent: NextGenAgentContext, trigger: CompactionTrigger, llms: AgentLLMs): Promise<CompactionResult> {
		const startIteration = agent.lastCompactionIteration + 1;
		const endIteration = agent.iterations;

		logger.info(`Compacting iterations ${startIteration}-${endIteration} (trigger: ${trigger})`);

		// 1. Trim recent history and capture trimmed messages
		const trimmedMessages = this.contextManager.trimRecentHistory(agent, this.config.recentTurnsToPreserve);

		// 2. Generate summary of completed work using LLM
		const summaryLLM = llms.easy;
		const { summary, keyDecisions } = await this.generateWorkSummary(agent, trimmedMessages, summaryLLM);

		// 3. Extract learnings if enabled
		let extractedLearnings: Learning[] = [];
		if (this.config.extractLearnings) {
			extractedLearnings = await this.extractLearnings(agent, trimmedMessages, summary, summaryLLM);
			agent.sessionLearnings.push(...extractedLearnings);
		}

		// 4. Identify and unload tool groups if enabled
		let unloadedToolGroups: string[] = [];
		let toolUsageSummary = '';
		if (this.config.unloadToolsOnCompaction) {
			const toolResult = this.unloadCompactedToolGroups(agent, trimmedMessages);
			unloadedToolGroups = toolResult.unloadedGroups;
			toolUsageSummary = toolResult.usageSummary;
		}

		// 5. Build the compacted summary content
		const compactedContent = this.buildCompactedContent(summary, keyDecisions, unloadedToolGroups, toolUsageSummary, agent.memory);

		// 6. Update agent state
		this.contextManager.setCompactedContext(agent, compactedContent, { start: startIteration, end: endIteration });
		agent.lastCompactionIteration = endIteration;
		agent.toolLoadingState.groupsUsedSinceLastCompaction.clear();

		// 7. Calculate tokens saved (rough estimate)
		const trimmedTokens = this.estimateTokens(trimmedMessages);
		const summaryTokens = Math.ceil(compactedContent.length / 4);
		const tokensSaved = Math.max(0, trimmedTokens - summaryTokens);

		logger.info(`Compaction complete: saved ~${tokensSaved} tokens, extracted ${extractedLearnings.length} learnings`);

		return {
			completedWorkSummary: summary,
			keyDecisions,
			extractedLearnings,
			unloadedToolGroups,
			toolUsageSummary,
			compactedIterationRange: { start: startIteration, end: endIteration },
			tokensSaved,
		};
	}

	/**
	 * Generates a summary of the completed work using LLM
	 */
	private async generateWorkSummary(agent: NextGenAgentContext, trimmedMessages: LlmMessage[], llm: LLM): Promise<{ summary: string; keyDecisions: string[] }> {
		if (trimmedMessages.length === 0) {
			return { summary: 'No significant work to summarize.', keyDecisions: [] };
		}

		// Build context from trimmed messages
		const conversationContext = this.formatMessagesForSummary(trimmedMessages);

		// Build context from function call history
		const recentFunctionCalls = agent.functionCallHistory.slice(-20);
		const functionContext = recentFunctionCalls
			.map((fc) => `- ${fc.function_name}(${JSON.stringify(fc.parameters).slice(0, 100)}) → ${(fc.stdout || '').slice(0, 200)}`)
			.join('\n');

		const prompt = `Summarize the following agent work into a concise summary and extract key decisions.

<task>
${agent.userPrompt}
</task>

<conversation>
${conversationContext}
</conversation>

<function_calls>
${functionContext}
</function_calls>

Respond with JSON in this format:
<json>
{
  "summary": "2-4 sentence summary of what was accomplished",
  "keyDecisions": ["decision 1", "decision 2"]
}
</json>

Focus on:
- What was accomplished
- Important files modified or created
- Key technical decisions made
- Any errors encountered and how they were resolved`;

		try {
			const response = await llm.generateText(prompt, { id: 'compaction-summary' });
			const parsed = extractJson<{ summary: string; keyDecisions: string[] }>(response);
			return {
				summary: parsed.summary || 'Work completed.',
				keyDecisions: parsed.keyDecisions || [],
			};
		} catch (error) {
			logger.warn(error, 'Failed to generate work summary, using fallback');
			return {
				summary: `Completed iterations ${agent.lastCompactionIteration + 1}-${agent.iterations}. ${trimmedMessages.length} messages compacted.`,
				keyDecisions: [],
			};
		}
	}

	/**
	 * Extracts learnings from the completed work
	 */
	private async extractLearnings(agent: NextGenAgentContext, trimmedMessages: LlmMessage[], summary: string, llm: LLM): Promise<Learning[]> {
		// Identify errors from function call history
		const errors: string[] = [];
		const successes: string[] = [];

		for (const fc of agent.functionCallHistory.slice(-20)) {
			if (fc.stderr) {
				errors.push(`${fc.function_name}: ${fc.stderr.slice(0, 200)}`);
			}
			if (fc.stdout && !fc.stderr) {
				successes.push(`${fc.function_name}: ${(fc.stdout || '').slice(0, 100)}`);
			}
		}

		if (errors.length === 0 && successes.length < 3) {
			// Not enough data to extract meaningful learnings
			return [];
		}

		const prompt = `Extract reusable learnings from this agent work.

<summary>
${summary}
</summary>

<errors_encountered>
${errors.join('\n') || 'None'}
</errors_encountered>

<successful_approaches>
${successes.slice(0, 10).join('\n')}
</successful_approaches>

Extract learnings that could help future agents. Respond with JSON:
<json>
{
  "learnings": [
    {
      "type": "pattern|pitfall|preference|context",
      "category": "category/subcategory",
      "content": "The actual learning",
      "confidence": 0.0-1.0,
      "tags": ["tag1", "tag2"]
    }
  ]
}
</json>

Types:
- pattern: A successful approach or technique
- pitfall: A mistake to avoid
- preference: A project-specific preference discovered
- context: Important context about the codebase

Only extract learnings with confidence >= 0.7. Return empty array if no clear learnings.`;

		try {
			const response = await llm.generateText(prompt, { id: 'learning-extraction' });
			const parsed = extractJson<{ learnings: Omit<Learning, 'id' | 'createdAt' | 'source'>[] }>(response);

			return (parsed.learnings || [])
				.filter((l) => l.confidence >= 0.7)
				.map((l) => ({
					...l,
					id: `learning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					createdAt: new Date(),
					source: {
						agentId: agent.agentId,
						task: agent.userPrompt.slice(0, 200),
						outcome: errors.length === 0 ? ('success' as const) : ('partial' as const),
						iterationRange: {
							start: agent.lastCompactionIteration + 1,
							end: agent.iterations,
						},
					},
				}));
		} catch (error) {
			logger.warn(error, 'Failed to extract learnings');
			return [];
		}
	}

	/**
	 * Identifies and unloads tool groups that were only used in compacted iterations
	 */
	private unloadCompactedToolGroups(agent: NextGenAgentContext, _trimmedMessages: LlmMessage[]): { unloadedGroups: string[]; usageSummary: string } {
		const groupsToUnload = Array.from(agent.toolLoadingState.groupsUsedSinceLastCompaction);

		if (groupsToUnload.length === 0) {
			return { unloadedGroups: [], usageSummary: '' };
		}

		// Build usage summary from function call history
		const functionsByGroup = new Map<string, string[]>();
		for (const group of groupsToUnload) {
			functionsByGroup.set(group, []);
		}

		// Note: In a full implementation, we'd track which functions belong to which groups
		// For now, we'll use a simple summary
		const usageSummary = `Tools used: ${groupsToUnload.join(', ')}`;

		// Remove tool schemas
		this.contextManager.removeToolSchemas(agent, groupsToUnload);

		return { unloadedGroups: groupsToUnload, usageSummary };
	}

	/**
	 * Builds the final compacted content to be stored in context
	 */
	private buildCompactedContent(
		summary: string,
		keyDecisions: string[],
		unloadedToolGroups: string[],
		toolUsageSummary: string,
		memory: Record<string, string>,
	): string {
		const sections: string[] = [];

		sections.push(`## Summary\n${summary}`);

		if (keyDecisions.length > 0) {
			sections.push(`## Key Decisions\n${keyDecisions.map((d) => `- ${d}`).join('\n')}`);
		}

		if (toolUsageSummary) {
			sections.push(`## Tools Used\n${toolUsageSummary}`);
		}

		if (unloadedToolGroups.length > 0) {
			sections.push(`## Unloaded Tool Groups\n${unloadedToolGroups.join(', ')}\n(Use Agent_loadToolGroup to reload if needed)`);
		}

		// Include relevant memory state
		const memoryEntries = Object.entries(memory).filter(([_, v]) => v.length < 500);
		if (memoryEntries.length > 0) {
			sections.push(`## Memory State\n${memoryEntries.map(([k, v]) => `- ${k}: ${v.slice(0, 100)}`).join('\n')}`);
		}

		return sections.join('\n\n');
	}

	/**
	 * Formats messages for the summary prompt
	 */
	private formatMessagesForSummary(messages: LlmMessage[]): string {
		return messages
			.map((m) => {
				const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
				// Truncate long messages
				const truncated = content.length > 500 ? `${content.slice(0, 500)}...` : content;
				return `[${m.role}]: ${truncated}`;
			})
			.join('\n\n');
	}

	/**
	 * Estimates token count for messages
	 */
	private estimateTokens(messages: LlmMessage[]): number {
		let chars = 0;
		for (const msg of messages) {
			if (typeof msg.content === 'string') {
				chars += msg.content.length;
			} else {
				for (const part of msg.content) {
					if ('text' in part) {
						chars += part.text.length;
					}
				}
			}
		}
		return Math.ceil(chars / 4);
	}

	/**
	 * Gets the compaction configuration
	 */
	getConfig(): CompactionConfig {
		return { ...this.config };
	}
}
