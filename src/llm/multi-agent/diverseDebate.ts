import { BaseLLM } from '#llm/base-llm';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { type GenerateTextOptions, type GenerationStats, type LLM, type LlmMessage, messageText, system, user } from '#shared/llm/llm.model';

// Helper function to initialize GenerationStats
function createEmptyStats(llmId: string): GenerationStats {
	return {
		requestTime: 0,
		timeToFirstToken: 0,
		totalTime: 0,
		inputTokens: 0,
		outputTokens: 0,
		cost: 0,
		llmId: llmId,
		cachedInputTokens: 0,
	};
}

// Helper function to accumulate stats
function accumulateStats(accumulator: GenerationStats, newStats?: GenerationStats): void {
	if (!newStats) return;
	accumulator.requestTime += newStats.requestTime || 0;
	accumulator.timeToFirstToken += newStats.timeToFirstToken || 0;
	accumulator.totalTime += newStats.totalTime || 0;
	accumulator.inputTokens += newStats.inputTokens || 0;
	accumulator.outputTokens += newStats.outputTokens || 0;
	accumulator.cachedInputTokens = (accumulator.cachedInputTokens || 0) + (newStats.cachedInputTokens || 0);
	accumulator.cost = (accumulator.cost || 0) + (newStats.cost || 0);
}

type ThinkingLevel = 'low' | 'medium' | 'high' | 'none';

interface CDDConfig {
	/** Number of samples for initial confidence check */
	confidenceSamples: number;
	/** Thinking level for confidence check samples (lower = faster) */
	confidenceThinking: ThinkingLevel;
	/** Temperature for confidence check samples */
	confidenceTemperature: number;
	/** Thinking level for initial diverse responses */
	initialResponseThinking: ThinkingLevel;
	/** Temperature for initial diverse responses */
	initialResponseTemperature: number;
	/** Thinking level for debate rounds */
	debateThinking: ThinkingLevel;
	/** Temperature for debate rounds */
	debateTemperature: number;
	/** Number of debate rounds (if triggered) */
	debateRounds: number;
	/** Thinking level for final mediation */
	mediationThinking: ThinkingLevel;
	/** Temperature for final mediation */
	mediationTemperature: number;
	/** Whether to print debug output */
	printOutput: boolean;
}

const defaultConfig: CDDConfig = {
	confidenceSamples: 3,
	confidenceThinking: 'low',
	confidenceTemperature: 0.5,
	initialResponseThinking: 'high',
	initialResponseTemperature: 0.7,
	debateThinking: 'high',
	debateTemperature: 0.5,
	debateRounds: 2,
	mediationThinking: 'high',
	mediationTemperature: 0.3,
	printOutput: false,
};

/**
 * Configuration for SOTA models - all temperature=1 for reasoning models
 */
const sotaConfig: CDDConfig = {
	confidenceSamples: 3,
	confidenceThinking: 'low',
	confidenceTemperature: 1,
	initialResponseThinking: 'high',
	initialResponseTemperature: 1,
	debateThinking: 'high',
	debateTemperature: 1,
	debateRounds: 2,
	mediationThinking: 'high',
	mediationTemperature: 1,
	printOutput: false,
};

export { defaultConfig as CDD_DefaultConfig, sotaConfig as CDD_SotaConfig };

/**
 * Confident Diverse Debate (CDD) LLM
 *
 * A hybrid multi-agent approach that combines confidence gating with diverse debate:
 *
 * 1. **Confidence Check**: Generate multiple samples from the primary LLM. If they're
 *    semantically consistent (checked via LLM), return early - no expensive debate needed.
 *
 * 2. **Diverse Initial Responses**: If confidence is low, generate initial responses from
 *    multiple LLMs configured with diverse reasoning strategies.
 *
 * 3. **Sparse Debate**: Each agent refines their answer based on their own response plus
 *    their neighbors' responses (sparse communication topology reduces groupthink).
 *
 * 4. **Mediation**: A mediator LLM synthesizes all debated responses into a final answer.
 *
 * Key innovation: The confidence gating can reduce calls from 10+ to just 4 for easy questions
 * where the primary model is already confident.
 *
 * Based on research from multiple arXiv papers on multi-agent debate systems.
 */
export class ConfidentDiverseDebateLLM extends BaseLLM {
	private primaryLLM: LLM;
	private debateLLMs: LLM[];
	private mediatorLLM: LLM;
	private config: CDDConfig;

	/**
	 * @param name Display name for this LLM configuration
	 * @param primaryLLMFactory Factory for the primary LLM used in confidence checking
	 * @param debateLLMFactories Factories for debate LLMs - each should be pre-configured with
	 *        a system prompt encouraging a diverse reasoning strategy
	 * @param mediatorLLMFactory Factory for the mediator LLM that synthesizes final response
	 * @param config Configuration options
	 */
	constructor(
		name: string,
		primaryLLMFactory: () => LLM,
		debateLLMFactories: Array<() => LLM>,
		mediatorLLMFactory: () => LLM,
		config: Partial<CDDConfig> = {},
	) {
		const primaryLLM = primaryLLMFactory();
		const debateLLMs = debateLLMFactories.map((factory) => factory());
		const mediatorLLM = mediatorLLMFactory();

		const modelId = `CDD:${primaryLLM.getModel()}|${debateLLMs.map((l) => l.getModel()).join('+')}|${mediatorLLM.getModel()}`;

		super({
			displayName: name,
			service: 'CDD',
			modelId,
			maxInputTokens: 200_000,
			calculateCosts: () => ({ inputCost: 0, outputCost: 0, totalCost: 0 }),
		});

		if (debateLLMs.length === 0) {
			throw new Error('ConfidentDiverseDebateLLM requires at least one debate LLM.');
		}

		this.primaryLLM = primaryLLM;
		this.debateLLMs = debateLLMs;
		this.mediatorLLM = mediatorLLM;
		this.config = { ...defaultConfig, ...config };
	}

	override isConfigured(): boolean {
		return this.primaryLLM.isConfigured() && this.mediatorLLM.isConfigured() && this.debateLLMs.every((llm) => llm.isConfigured());
	}

	override getModel(): string {
		return this.modelId;
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected override async generateTextFromMessages(llmMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		opts ??= {};

		return withActiveSpan(`CDD id:${opts?.id ?? 'N/A'}`, async () => {
			const totalStats: GenerationStats = createEmptyStats(this.getId());

			// Phase 1: Confidence Check
			if (this.config.printOutput) {
				logger.info(`[CDD] Phase 1: Confidence check with ${this.primaryLLM.getDisplayName()}`);
			}

			const { samples, stats: confidenceStats } = await this.generateConfidenceSamples(llmMessages, opts);
			confidenceStats.forEach((s) => accumulateStats(totalStats, s));

			const { isConsistent, stats: consistencyStats } = await this.checkSemanticConsistency(samples, llmMessages, opts);
			accumulateStats(totalStats, consistencyStats);

			if (isConsistent) {
				if (this.config.printOutput) {
					logger.info('[CDD] High confidence - responses are consistent. Skipping debate.');
				}
				// Return the first sample (they're all semantically equivalent)
				return samples[0];
			}

			if (this.config.printOutput) {
				logger.info('[CDD] Low confidence - responses inconsistent. Proceeding to debate.');
			}

			// Phase 2: Generate Initial Diverse Responses
			if (this.config.printOutput) {
				logger.info(`[CDD] Phase 2: Generating ${this.debateLLMs.length} diverse initial responses`);
			}

			const { responses: initialResponses, stats: initialStats } = await this.generateInitialDiverseResponses(
				llmMessages,
				opts,
				samples, // Pass confidence samples as potential starting points
			);
			initialStats.forEach((s) => accumulateStats(totalStats, s));

			// Phase 3: Sparse Debate
			if (this.config.printOutput) {
				logger.info(`[CDD] Phase 3: Running ${this.config.debateRounds} debate rounds`);
			}

			const { responses: debatedResponses, stats: debateStats } = await this.multiAgentSparseDebate(llmMessages, initialResponses, opts);
			debateStats.forEach((s) => accumulateStats(totalStats, s));

			// Phase 4: Final Mediation
			if (this.config.printOutput) {
				logger.info(`[CDD] Phase 4: Mediating final response with ${this.mediatorLLM.getDisplayName()}`);
			}

			const { response: finalResponse, stats: mediationStats } = await this.synthesizeFinalResponse(llmMessages, debatedResponses, opts);
			accumulateStats(totalStats, mediationStats);

			return finalResponse;
		});
	}

	/**
	 * Phase 1a: Generate multiple samples from the primary LLM for confidence checking.
	 */
	private async generateConfidenceSamples(
		llmMessages: ReadonlyArray<LlmMessage>,
		opts: GenerateTextOptions,
	): Promise<{ samples: string[]; stats: (GenerationStats | undefined)[] }> {
		const samplePromises = Array.from({ length: this.config.confidenceSamples }, () =>
			this.primaryLLM.generateMessage(llmMessages, {
				...opts,
				thinking: this.config.confidenceThinking,
				temperature: this.config.confidenceTemperature,
			}),
		);

		const results = await Promise.all(samplePromises);
		return {
			samples: results.map((r) => messageText(r)),
			stats: results.map((r) => r.stats),
		};
	}

	/**
	 * Phase 1b: Use an LLM to check if the samples are semantically consistent.
	 * This is much more robust than exact string matching.
	 */
	private async checkSemanticConsistency(
		samples: string[],
		originalMessages: ReadonlyArray<LlmMessage>,
		opts: GenerateTextOptions,
	): Promise<{ isConsistent: boolean; stats?: GenerationStats }> {
		if (samples.length < 2) {
			return { isConsistent: true };
		}

		const originalQuery = messageText(originalMessages[originalMessages.length - 1]);

		const samplesText = samples.map((sample, index) => `<response_${index + 1}>\n${sample}\n</response_${index + 1}>`).join('\n\n');

		const consistencyCheckMessages: LlmMessage[] = [
			system(`You are evaluating whether multiple AI responses to the same question are substantively consistent with each other.

Your task is to determine if the responses arrive at the same conclusion/answer, even if they use different wording or explanations.

Consider responses CONSISTENT if:
- They reach the same final answer or conclusion
- They recommend the same action or approach
- Any differences are only in phrasing, detail level, or explanation style

Consider responses INCONSISTENT if:
- They reach different final answers or conclusions
- They recommend conflicting actions or approaches
- They contain contradictory factual claims
- One response is uncertain while another is confident about a different answer

Respond with ONLY "CONSISTENT" or "INCONSISTENT" followed by a brief one-sentence explanation.`),
			user(`Original Question:
<question>
${originalQuery}
</question>

Responses to evaluate:
${samplesText}

Are these responses substantively consistent with each other?`),
		];

		try {
			const response = await this.primaryLLM.generateMessage(consistencyCheckMessages, {
				...opts,
				thinking: 'low', // Quick check
				temperature: 0, // Deterministic
			});

			const responseText = messageText(response).toUpperCase();
			const isConsistent = responseText.startsWith('CONSISTENT');

			if (this.config.printOutput) {
				logger.debug(`[CDD] Consistency check result: ${isConsistent ? 'CONSISTENT' : 'INCONSISTENT'}`);
			}

			return { isConsistent, stats: response.stats };
		} catch (error) {
			logger.warn(`[CDD] Consistency check failed: ${(error as Error).message}. Assuming inconsistent.`);
			return { isConsistent: false };
		}
	}

	/**
	 * Phase 2: Generate initial diverse responses from debate LLMs.
	 * Incorporates confidence samples to avoid wasting that work.
	 */
	private async generateInitialDiverseResponses(
		llmMessages: ReadonlyArray<LlmMessage>,
		opts: GenerateTextOptions,
		confidenceSamples: string[],
	): Promise<{ responses: string[]; stats: (GenerationStats | undefined)[] }> {
		// If we have enough confidence samples, use some of them as starting points
		// This avoids completely discarding the work from phase 1
		const responses: string[] = [];
		const stats: (GenerationStats | undefined)[] = [];

		const responsePromises = this.debateLLMs.map(async (llm, index) => {
			// For the first N debate LLMs where we have confidence samples,
			// give them the sample as context to build upon
			if (index < confidenceSamples.length) {
				const originalQuery = messageText(llmMessages[llmMessages.length - 1]);
				const enhancedMessages: LlmMessage[] = [
					...llmMessages.slice(0, -1), // All messages except last
					user(`${originalQuery}

A previous attempt at answering this question produced the following response. Please critically evaluate it and provide your own answer, which may agree, disagree, or build upon it:

<previous_response>
${confidenceSamples[index]}
</previous_response>

Provide your response to the original question:`),
				];

				const result = await llm.generateMessage(enhancedMessages, {
					...opts,
					thinking: this.config.initialResponseThinking,
					temperature: this.config.initialResponseTemperature,
				});

				return { response: messageText(result), stats: result.stats };
			}

			// For additional debate LLMs beyond our sample count, generate fresh
			const result = await llm.generateMessage(llmMessages, {
				...opts,
				thinking: this.config.initialResponseThinking,
				temperature: this.config.initialResponseTemperature,
			});

			return { response: messageText(result), stats: result.stats };
		});

		const results = await Promise.all(responsePromises);
		return {
			responses: results.map((r) => r.response),
			stats: results.map((r) => r.stats),
		};
	}

	/**
	 * Phase 3: Multi-round sparse debate where each agent sees only neighbors.
	 */
	private async multiAgentSparseDebate(
		originalMessages: ReadonlyArray<LlmMessage>,
		initialResponses: string[],
		opts: GenerateTextOptions,
	): Promise<{ responses: string[]; stats: (GenerationStats | undefined)[] }> {
		let currentResponses = [...initialResponses];
		const allStats: (GenerationStats | undefined)[] = [];
		const originalUserQuery = messageText(originalMessages[originalMessages.length - 1]);
		const numAgents = this.debateLLMs.length;

		for (let round = 0; round < this.config.debateRounds; round++) {
			if (this.config.printOutput) {
				logger.debug(`[CDD] Debate round ${round + 1}/${this.config.debateRounds}`);
			}

			const roundPromises = this.debateLLMs.map(async (llm, index) => {
				const selfResponse = currentResponses[index];

				// Sparse topology: only see immediate neighbors
				const leftNeighborIndex = (index - 1 + numAgents) % numAgents;
				const rightNeighborIndex = (index + 1) % numAgents;

				// Handle edge case where there are only 1 or 2 agents
				let neighborsText: string;
				if (numAgents === 1) {
					// Single agent: no neighbors, just refine own response
					neighborsText = '(No other agent responses available)';
				} else if (numAgents === 2) {
					// Two agents: only one neighbor
					const neighborIndex = index === 0 ? 1 : 0;
					neighborsText = `Neighbor Agent's Response:
<neighbor_response>
${currentResponses[neighborIndex]}
</neighbor_response>`;
				} else {
					// Three or more: two neighbors
					neighborsText = `Neighbor Agent 1's Response:
<neighbor_1_response>
${currentResponses[leftNeighborIndex]}
</neighbor_1_response>

Neighbor Agent 2's Response:
<neighbor_2_response>
${currentResponses[rightNeighborIndex]}
</neighbor_2_response>`;
				}

				const debateMessages: LlmMessage[] = [
					system(`You are participating in a collaborative refinement process to produce the best possible answer to a user query.

Your previous response and responses from neighboring agents are provided. Your task is to:
1. Critically evaluate your own response for any errors or gaps
2. Consider the strengths and insights from the neighboring responses
3. Identify any contradictions or inconsistencies
4. Produce an improved, comprehensive response that incorporates the best elements

Do not mention the refinement process or other agents in your output. Directly address the user query.`),
					user(`Original User Query:
<user_query>
${originalUserQuery}
</user_query>

Your Previous Response:
<your_response>
${selfResponse}
</your_response>

${neighborsText}

Based on all the above, provide your refined and improved answer to the Original User Query:`),
				];

				const result = await llm.generateMessage(debateMessages, {
					...opts,
					thinking: this.config.debateThinking,
					temperature: this.config.debateTemperature,
				});

				return { response: messageText(result), stats: result.stats };
			});

			const roundResults = await Promise.all(roundPromises);
			currentResponses = roundResults.map((r) => r.response);
			roundResults.forEach((r) => allStats.push(r.stats));
		}

		return { responses: currentResponses, stats: allStats };
	}

	/**
	 * Phase 4: Mediator synthesizes all debated responses into a final answer.
	 */
	private async synthesizeFinalResponse(
		originalMessages: ReadonlyArray<LlmMessage>,
		responses: string[],
		opts: GenerateTextOptions,
	): Promise<{ response: string; stats?: GenerationStats }> {
		const originalUserQuery = messageText(originalMessages[originalMessages.length - 1]);

		const responsesText = responses.map((response, index) => `<proposed_answer_${index + 1}>\n${response}\n</proposed_answer_${index + 1}>`).join('\n\n');

		const mediationMessages: LlmMessage[] = [
			system(`You are a mediator tasked with synthesizing multiple proposed answers into a single, optimal response.

Your task is to:
1. Identify the strongest elements and insights from each proposed answer
2. Resolve any contradictions by determining the most accurate or well-reasoned position
3. Combine the best elements into a comprehensive, coherent response
4. Ensure the final answer is accurate, complete, and well-structured

Do not mention the multiple proposals or synthesis process. Directly address the user query with the best possible answer.`),
			user(`Original User Query:
<user_query>
${originalUserQuery}
</user_query>

Proposed Answers:
${responsesText}

Synthesize these into the best possible final answer to the Original User Query:`),
		];

		const result = await this.mediatorLLM.generateMessage(mediationMessages, {
			...opts,
			thinking: this.config.mediationThinking,
			temperature: this.config.mediationTemperature,
		});

		return { response: messageText(result), stats: result.stats };
	}
}

// ============================================================================
// Factory Functions
// ============================================================================

import { anthropicClaude4_5_Sonnet } from '#llm/services/anthropic';
import { Claude4_5_Opus_Vertex, Claude4_5_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { deepinfraDeepSeekR1 } from '#llm/services/deepinfra';
import { openaiGPT5 } from '#llm/services/openai';
import { vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import { xai_Grok4 } from '#llm/services/xai';

/**
 * Cost-optimized CDD using DeepSeek R1
 */
export function CDD_Cost(): LLM {
	return new ConfidentDiverseDebateLLM(
		'CDD:Cost (DeepSeek R1)',
		deepinfraDeepSeekR1,
		[deepinfraDeepSeekR1, deepinfraDeepSeekR1, deepinfraDeepSeekR1],
		deepinfraDeepSeekR1,
		defaultConfig,
	);
}

/**
 * Balanced CDD with model diversity
 */
export function CDD_Balanced(): LLM {
	return new ConfidentDiverseDebateLLM(
		'CDD:Balanced (Gemini, Grok, GPT5)',
		vertexGemini_2_5_Pro,
		[vertexGemini_2_5_Pro, xai_Grok4, openaiGPT5],
		vertexGemini_2_5_Pro,
		sotaConfig,
	);
}

/**
 * SOTA CDD with maximum model diversity
 */
export function CDD_SOTA(): LLM {
	return new ConfidentDiverseDebateLLM(
		'CDD:SOTA (Opus, GPT5, Gemini, Grok)',
		Claude4_5_Opus_Vertex,
		[Claude4_5_Opus_Vertex, openaiGPT5, vertexGemini_2_5_Pro, xai_Grok4],
		openaiGPT5,
		sotaConfig,
	);
}

/**
 * Vertex-only CDD (useful for enterprise environments)
 */
export function CDD_Vertex(): LLM {
	return new ConfidentDiverseDebateLLM(
		'CDD:Vertex (Gemini, Sonnet)',
		vertexGemini_2_5_Pro,
		[vertexGemini_2_5_Pro, vertexGemini_2_5_Pro, Claude4_5_Sonnet_Vertex],
		vertexGemini_2_5_Pro,
		sotaConfig,
	);
}

/**
 * Anthropic-only CDD
 */
export function CDD_Anthropic(): LLM {
	return new ConfidentDiverseDebateLLM(
		'CDD:Anthropic (Sonnet x3)',
		anthropicClaude4_5_Sonnet,
		[anthropicClaude4_5_Sonnet, anthropicClaude4_5_Sonnet, anthropicClaude4_5_Sonnet],
		anthropicClaude4_5_Sonnet,
		sotaConfig,
	);
}
