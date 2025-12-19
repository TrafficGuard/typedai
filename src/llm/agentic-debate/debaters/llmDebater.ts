/**
 * Standard LLM Debater implementation.
 *
 * Uses the existing LLM interface to generate debate positions with tool support.
 * Tools are executed externally and results are provided in the context.
 *
 * @module agentic-debate/debaters/llmDebater
 */

import { logger } from '#o11y/logger';
import type { LLM } from '#shared/llm/llm.model';
import { buildDebateRoundPrompt, buildInitialPositionPrompt, extractJsonFromResponse } from '../debatePrompts';
import { executeToolRequests } from '../debateTools';
import type { DebateContext, DebatePosition, DebateResponse, DebaterType, IDebater, ToolCallRecord } from '../toolEnabledDebate';

const log = logger.child({ module: 'LlmDebater' });

/**
 * Configuration for the LLM debater
 */
export interface LlmDebaterConfig {
	id: string;
	name: string;
	llm: LLM;
	/** Maximum tool calls per turn to prevent runaway */
	maxToolCallsPerTurn?: number;
	/** Optional persona/additional instructions */
	persona?: string;
}

/**
 * LLM-based debater that uses generateTextWithJson for structured responses
 */
export class LlmDebater implements IDebater {
	readonly id: string;
	readonly name: string;
	readonly type: DebaterType = 'llm';

	private readonly llm: LLM;
	private readonly maxToolCallsPerTurn: number;
	private readonly persona?: string;

	constructor(config: LlmDebaterConfig) {
		this.id = config.id;
		this.name = config.name;
		this.llm = config.llm;
		this.maxToolCallsPerTurn = config.maxToolCallsPerTurn ?? 5;
		this.persona = config.persona;
	}

	/**
	 * Generate an initial position on the topic
	 */
	async generateInitialPosition(topic: string, context: DebateContext): Promise<DebateResponse> {
		log.info({ agentId: this.id, topic }, 'Generating initial position');

		const prompt = buildInitialPositionPrompt(topic, this.addPersonaToContext(context));

		const response = await this.llm.generateText(prompt, {
			id: `debate-initial-${this.id}`,
			thinking: 'high',
			temperature: 0.7,
		});

		const parsed = this.parseResponse(response);

		// Execute any tool requests
		if (parsed.toolRequests && parsed.toolRequests.length > 0) {
			const toolResults = await this.executeToolsAndRefine(topic, context, parsed);
			return toolResults;
		}

		return parsed;
	}

	/**
	 * Generate a response in a debate round
	 */
	async generateDebateResponse(topic: string, context: DebateContext, neighborPositions: DebatePosition[]): Promise<DebateResponse> {
		log.info({ agentId: this.id, round: context.round, neighbors: neighborPositions.length }, 'Generating debate response');

		const prompt = buildDebateRoundPrompt(topic, this.addPersonaToContext(context), neighborPositions);

		const response = await this.llm.generateText(prompt, {
			id: `debate-round${context.round}-${this.id}`,
			thinking: 'high',
			temperature: 0.5,
		});

		const parsed = this.parseResponse(response);

		// Execute any tool requests
		if (parsed.toolRequests && parsed.toolRequests.length > 0) {
			const toolResults = await this.executeToolsAndRefine(topic, context, parsed, neighborPositions);
			return toolResults;
		}

		return parsed;
	}

	/**
	 * Execute tools and generate refined response
	 */
	private async executeToolsAndRefine(
		topic: string,
		context: DebateContext,
		initialResponse: DebateResponse,
		neighborPositions?: DebatePosition[],
	): Promise<DebateResponse> {
		let currentResponse = initialResponse;
		let toolCallCount = 0;
		const allToolCalls: ToolCallRecord[] = [];

		while (currentResponse.toolRequests && currentResponse.toolRequests.length > 0 && toolCallCount < this.maxToolCallsPerTurn) {
			// Execute the requested tools
			const toolResults = await executeToolRequests(context.tools, currentResponse.toolRequests, this.id);

			allToolCalls.push(...toolResults);
			toolCallCount += toolResults.length;

			// Create updated context with tool results
			const updatedContext: DebateContext = {
				...context,
				sharedToolResults: [...context.sharedToolResults, ...toolResults],
			};

			// Generate refined response with tool results
			const prompt = neighborPositions
				? buildDebateRoundPrompt(topic, this.addPersonaToContext(updatedContext), neighborPositions)
				: buildInitialPositionPrompt(topic, this.addPersonaToContext(updatedContext));

			const refinedText = await this.llm.generateText(prompt, {
				id: `debate-refine-${this.id}-${toolCallCount}`,
				thinking: 'high',
				temperature: 0.5,
			});

			currentResponse = this.parseResponse(refinedText);
		}

		// Include all tool calls in the final response
		return {
			...currentResponse,
			toolRequests: undefined, // Clear tool requests from final response
		};
	}

	/**
	 * Parse the LLM response into a DebateResponse
	 */
	private parseResponse(response: string): DebateResponse {
		try {
			return extractJsonFromResponse<DebateResponse>(response);
		} catch (error) {
			log.warn({ agentId: this.id, error }, 'Failed to parse JSON response, extracting manually');

			// Fallback: try to extract key fields
			return {
				position: this.extractSection(response, 'position') || response.slice(0, 500),
				confidence: 0.5,
				reasoning: this.extractSection(response, 'reasoning') || response,
				citations: [],
				codeTraces: [],
			};
		}
	}

	/**
	 * Extract a section from unstructured text
	 */
	private extractSection(text: string, section: string): string | null {
		const patterns = [
			new RegExp(`"${section}"\\s*:\\s*"([^"]*)"`, 'i'),
			new RegExp(`${section}:\\s*(.+?)(?:\\n|$)`, 'i'),
			new RegExp(`<${section}>([\\s\\S]*?)</${section}>`, 'i'),
		];

		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (match) return match[1].trim();
		}

		return null;
	}

	/**
	 * Add persona to context if configured
	 */
	private addPersonaToContext(context: DebateContext): DebateContext {
		if (!this.persona) return context;

		return {
			...context,
			backgroundContext: context.backgroundContext
				? `${context.backgroundContext}\n\nADDITIONAL INSTRUCTIONS:\n${this.persona}`
				: `ADDITIONAL INSTRUCTIONS:\n${this.persona}`,
		};
	}
}

/**
 * Factory function to create an LLM debater
 */
export function createLlmDebater(config: LlmDebaterConfig): IDebater {
	return new LlmDebater(config);
}
