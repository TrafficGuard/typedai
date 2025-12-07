/**
 * Learning Extractor for NextGen Agent
 *
 * Extracts reusable learnings from completed agent work. Learnings include:
 * - Patterns: Successful approaches or techniques
 * - Pitfalls: Mistakes to avoid
 * - Preferences: Project-specific preferences discovered
 * - Context: Important context about the codebase
 */

import { logger } from '#o11y/logger';
import type { LLM, LlmMessage } from '#shared/llm/llm.model';
import type { Learning, LearningSource, LearningType, NextGenAgentContext } from '../core/types';

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
 * Configuration for learning extraction
 */
export interface LearningExtractorConfig {
	/** Minimum confidence threshold for extracted learnings (0-1, default: 0.7) */
	minConfidence?: number;
	/** Maximum learnings to extract per compaction (default: 5) */
	maxLearningsPerExtraction?: number;
	/** Categories to focus on (if empty, all categories) */
	focusCategories?: string[];
}

/**
 * Context for learning extraction
 */
export interface ExtractionContext {
	/** Summary of the completed work */
	summary: string;
	/** Errors encountered during work */
	errors: string[];
	/** Successful approaches taken */
	successes: string[];
	/** Messages that were part of the compacted work */
	compactedMessages: LlmMessage[];
	/** Current agent state */
	agent: NextGenAgentContext;
}

/**
 * Extracts learnings from completed agent work
 */
export class LearningExtractor {
	private config: Required<LearningExtractorConfig>;

	constructor(config: LearningExtractorConfig = {}) {
		this.config = {
			minConfidence: config.minConfidence ?? 0.7,
			maxLearningsPerExtraction: config.maxLearningsPerExtraction ?? 5,
			focusCategories: config.focusCategories ?? [],
		};
	}

	/**
	 * Extracts learnings from the given context
	 */
	async extract(context: ExtractionContext, llm: LLM): Promise<Learning[]> {
		// Check if there's enough data to extract meaningful learnings
		if (!this.hasEnoughData(context)) {
			logger.debug('Not enough data for learning extraction');
			return [];
		}

		try {
			const prompt = this.buildExtractionPrompt(context);
			const response = await llm.generateText(prompt, { id: 'learning-extraction' });
			const parsed = this.parseResponse(response);

			// Filter and enrich learnings
			const learnings = parsed
				.filter((l) => l.confidence >= this.config.minConfidence)
				.slice(0, this.config.maxLearningsPerExtraction)
				.map((l) => this.enrichLearning(l, context));

			logger.info(`Extracted ${learnings.length} learnings from context`);
			return learnings;
		} catch (error) {
			logger.warn(error, 'Failed to extract learnings');
			return [];
		}
	}

	/**
	 * Extracts learnings specifically from errors and how they were resolved
	 */
	async extractFromErrors(errors: Array<{ error: string; resolution: string }>, context: { task: string; agentId: string }, llm: LLM): Promise<Learning[]> {
		if (errors.length === 0) {
			return [];
		}

		const prompt = `Analyze these errors and their resolutions to extract reusable pitfalls to avoid.

<task>
${context.task}
</task>

<errors_and_resolutions>
${errors.map((e, i) => `${i + 1}. Error: ${e.error}\n   Resolution: ${e.resolution}`).join('\n\n')}
</errors_and_resolutions>

Extract pitfalls that would help future agents avoid these errors. Respond with JSON:
<json>
{
  "learnings": [
    {
      "type": "pitfall",
      "category": "category/subcategory",
      "content": "What to avoid and why",
      "confidence": 0.0-1.0,
      "tags": ["tag1", "tag2"]
    }
  ]
}
</json>

Only include learnings with confidence >= 0.7 that would be genuinely useful.`;

		try {
			const response = await llm.generateText(prompt, { id: 'error-learning-extraction' });
			const parsed = this.parseResponse(response);

			return parsed
				.filter((l) => l.confidence >= this.config.minConfidence)
				.map((l) => ({
					...l,
					id: this.generateId(),
					createdAt: new Date(),
					source: {
						agentId: context.agentId,
						task: context.task.slice(0, 200),
						outcome: 'partial' as const,
					},
				}));
		} catch (error) {
			logger.warn(error, 'Failed to extract learnings from errors');
			return [];
		}
	}

	/**
	 * Extracts patterns from successful code changes
	 */
	async extractFromCodeChanges(
		changes: Array<{ file: string; before: string; after: string; reason: string }>,
		context: { task: string; agentId: string },
		llm: LLM,
	): Promise<Learning[]> {
		if (changes.length === 0) {
			return [];
		}

		const prompt = `Analyze these code changes to extract reusable patterns and best practices.

<task>
${context.task}
</task>

<code_changes>
${changes
	.map(
		(c, i) => `${i + 1}. File: ${c.file}
   Reason: ${c.reason}
   Before: ${c.before.slice(0, 300)}
   After: ${c.after.slice(0, 300)}`,
	)
	.join('\n\n')}
</code_changes>

Extract patterns that would help future agents write similar code. Respond with JSON:
<json>
{
  "learnings": [
    {
      "type": "pattern",
      "category": "category/subcategory",
      "content": "The pattern or best practice",
      "confidence": 0.0-1.0,
      "tags": ["tag1", "tag2"]
    }
  ]
}
</json>

Only include learnings with confidence >= 0.7 that represent clear, reusable patterns.`;

		try {
			const response = await llm.generateText(prompt, { id: 'code-change-learning-extraction' });
			const parsed = this.parseResponse(response);

			return parsed
				.filter((l) => l.confidence >= this.config.minConfidence)
				.map((l) => ({
					...l,
					id: this.generateId(),
					createdAt: new Date(),
					source: {
						agentId: context.agentId,
						task: context.task.slice(0, 200),
						outcome: 'success' as const,
					},
				}));
		} catch (error) {
			logger.warn(error, 'Failed to extract learnings from code changes');
			return [];
		}
	}

	/**
	 * Checks if there's enough data to warrant learning extraction
	 */
	private hasEnoughData(context: ExtractionContext): boolean {
		// Need at least some errors OR some successes to extract from
		return context.errors.length > 0 || context.successes.length >= 3;
	}

	/**
	 * Builds the extraction prompt
	 */
	private buildExtractionPrompt(context: ExtractionContext): string {
		const categoryFocus = this.config.focusCategories.length > 0 ? `\nFocus on these categories: ${this.config.focusCategories.join(', ')}` : '';

		return `Extract reusable learnings from this agent work.

<task>
${context.agent.userPrompt}
</task>

<summary>
${context.summary}
</summary>

<errors_encountered>
${context.errors.join('\n') || 'None'}
</errors_encountered>

<successful_approaches>
${context.successes.slice(0, 10).join('\n')}
</successful_approaches>
${categoryFocus}
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

Only extract learnings with confidence >= ${this.config.minConfidence}. Return empty array if no clear learnings.`;
	}

	/**
	 * Parses the LLM response
	 */
	private parseResponse(response: string): Array<{
		type: LearningType;
		category: string;
		content: string;
		confidence: number;
		tags: string[];
	}> {
		try {
			const parsed = extractJson<{
				learnings: Array<{
					type: LearningType;
					category: string;
					content: string;
					confidence: number;
					tags: string[];
				}>;
			}>(response);
			return parsed.learnings || [];
		} catch (error) {
			logger.warn(error, 'Failed to parse learning extraction response');
			return [];
		}
	}

	/**
	 * Enriches a raw learning with ID, timestamp, and source
	 */
	private enrichLearning(
		raw: { type: LearningType; category: string; content: string; confidence: number; tags: string[] },
		context: ExtractionContext,
	): Learning {
		const source: LearningSource = {
			agentId: context.agent.agentId,
			task: context.agent.userPrompt.slice(0, 200),
			outcome: context.errors.length === 0 ? 'success' : 'partial',
			iterationRange: {
				start: context.agent.lastCompactionIteration + 1,
				end: context.agent.iterations,
			},
		};

		return {
			...raw,
			id: this.generateId(),
			createdAt: new Date(),
			source,
		};
	}

	/**
	 * Generates a unique ID for a learning
	 */
	private generateId(): string {
		return `learning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	}

	/**
	 * Gets the configuration
	 */
	getConfig(): Required<LearningExtractorConfig> {
		return { ...this.config };
	}
}
