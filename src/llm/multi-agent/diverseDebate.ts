import { BaseLLM } from '#llm/base-llm';
import { getLLM } from '#llm/llmFactory'; // Assuming this can fetch pre-configured LLMs
import { logger } from '#o11y/logger';
import {
	type GenerateTextOptions,
	GenerationStats,
	type LLM,
	type LlmMessage,
	type UserContentExt,
	lastText,
	messageText,
	system,
	user,
} from '#shared/llm/llm.model';

// Constants for the Confident Diverse Debate (CDD) system
const INITIAL_CONFIDENCE_SAMPLES = 3; // Number of samples for initial confidence check
const INITIAL_CONFIDENCE_TEMP = 0.5; // Temperature for confidence check samples
const INITIAL_RESPONSE_TEMP = 0.7; // Temperature for initial diverse responses in debate
const DEBATE_TEMP = 0.5;
const FINAL_MEDIATION_TEMP = 0.3;
const DEBATE_ROUNDS = 2; // Number of debate rounds if triggered

// Helper to check response consistency (simple version)
function checkConsistency(responses: string[]): boolean {
	if (responses.length < 2) return true; // Or false, depending on desired strictness
	const firstResponse = responses[0].trim();
	return responses.every((r) => r.trim() === firstResponse);
}

export class ConfidentDiverseDebateLLM extends BaseLLM {
	primaryLLM: LLM;
	debateLLMs: LLM[]; // These should be pre-configured with diverse system prompts
	mediatorLLM: LLM;

	generationStats: GenerationStats = {
		requestTime: 0,
		timeToFirstToken: 0,
		totalTime: 0,
		inputTokens: 0,
		outputTokens: 0,
		llmId: '',
	};

	constructor(
		name: string,
		primaryLLMFactory: () => LLM,
		// Each factory should produce an LLM pre-configured with a system prompt for a diverse reasoning strategy
		debateLLMFactories: Array<() => LLM>,
		mediatorLLMFactory: () => LLM,
	) {
		// The model ID string here is a conceptual representation
		const modelId = `CDD:${primaryLLMFactory().getModel()}|${debateLLMFactories.map((f) => f().getModel()).join('+')}|${mediatorLLMFactory().getModel()}`;
		super(name, 'CDD', modelId, 200_000, () => ({ inputCost: 0, outputCost: 0, totalCost: 0 }));

		this.primaryLLM = primaryLLMFactory();
		this.debateLLMs = debateLLMFactories.map((factory) => factory());
		this.mediatorLLM = mediatorLLMFactory();

		if (this.debateLLMs.length === 0) throw new Error('ConfidentDiverseDebateLLM requires at least one debate LLM.');
	}

	override isConfigured(): boolean {
		return this.primaryLLM.isConfigured() && this.mediatorLLM.isConfigured() && this.debateLLMs.every((llm) => llm.isConfigured());
	}

	override getModel(): string {
		return this.model; // Returns the conceptual ID
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected override async generateTextFromMessages(llmMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string> {
		logger.info(`[${this.getDisplayName()}] Phase 1: Initial Confidence Check with ${this.primaryLLM.getDisplayName()}`);

		// Generate a few samples for confidence check
		const confidenceCheckSamples: string[] = [];
		for (let i = 0; i < INITIAL_CONFIDENCE_SAMPLES; i++) {
			confidenceCheckSamples.push(
				await this.primaryLLM.generateText(llmMessages, {
					...opts,
					temperature: INITIAL_CONFIDENCE_TEMP,
					thinking: 'low', // Faster for confidence check
				}),
			);
		}

		if (checkConsistency(confidenceCheckSamples)) {
			logger.info(`[${this.getDisplayName()}] High confidence in initial response. Skipping debate.`);
			this.generationStats.outputTokens += await this.countTokens(confidenceCheckSamples[0]); // Approximate
			return confidenceCheckSamples[0]; // Return one of the consistent samples
		}

		logger.info(`[${this.getDisplayName()}] Low confidence in initial response. Proceeding to debate.`);
		logger.info(`[${this.getDisplayName()}] Phase 2: Generating initial diverse responses.`);
		const initialDiverseResponses = await this.generateInitialDiverseResponses(llmMessages, opts);

		logger.info(`[${this.getDisplayName()}] Phase 3: Debating responses for ${DEBATE_ROUNDS - 1} rounds.`);
		const debatedResponses = await this.multiAgentSparseDebate(llmMessages, initialDiverseResponses, opts, DEBATE_ROUNDS);

		logger.info(`[${this.getDisplayName()}] Phase 4: Mediating final response with ${this.mediatorLLM.getDisplayName()}.`);
		const finalResponse = await this.synthesizeFinalResponse(llmMessages, debatedResponses, opts);
		this.generationStats.outputTokens += await this.countTokens(finalResponse); // Approximate
		return finalResponse;
	}

	private async generateInitialDiverseResponses(llmMessages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<string[]> {
		// Assumes each LLM in this.debateLLMs is already configured with a system prompt
		// that encourages a diverse reasoning strategy.
		return Promise.all(
			this.debateLLMs.map((llm) =>
				llm.generateText(llmMessages, {
					...opts,
					temperature: INITIAL_RESPONSE_TEMP,
					thinking: 'high', // Allow more thought for diverse initial takes
				}),
			),
		);
	}

	private async multiAgentSparseDebate(
		originalMessages: ReadonlyArray<LlmMessage>,
		currentResponses: string[],
		opts?: GenerateTextOptions,
		totalRounds = DEBATE_ROUNDS,
	): Promise<string[]> {
		let debatedResponses = [...currentResponses];
		const originalUserQuery = messageText(originalMessages[originalMessages.length - 1]);

		// The first round of responses (initialDiverseResponses) is already done.
		// So, debate rounds start from the "second" round of interactions.
		for (let round = 1; round < totalRounds; round++) {
			logger.info(`Debate Round ${round + 1}/${totalRounds}...`);
			const nextRoundResponses = await Promise.all(
				this.debateLLMs.map(async (llm, index) => {
					const selfResponse = debatedResponses[index];
					// Simple neighbor communication: one left, one right.
					const leftNeighborIndex = (index - 1 + this.debateLLMs.length) % this.debateLLMs.length;
					const rightNeighborIndex = (index + 1) % this.debateLLMs.length;

					const debateContextMessages: LlmMessage[] = [
						system(
							`You are participating in a debate to refine an answer to a user query.
Your previous response and responses from two other agents are provided.
Critically evaluate all responses, identify strengths and weaknesses, and provide an improved, comprehensive response to the original user query.
Do not explicitly mention the debate process or other agents in your final output. Directly address the user query.`,
						),
						user(`Original User Query:
<user_query>
${originalUserQuery}
</user_query>

Your Previous Response:
<your_response>
${selfResponse}
</your_response>

Neighbor Agent 1's Response:
<neighbor_1_response>
${debatedResponses[leftNeighborIndex]}
</neighbor_1_response>

Neighbor Agent 2's Response:
<neighbor_2_response>
${debatedResponses[rightNeighborIndex]}
</neighbor_2_response>

Based on all the above, provide your refined and improved answer to the Original User Query:`),
					];

					return llm.generateText(debateContextMessages, { ...opts, temperature: DEBATE_TEMP });
				}),
			);
			debatedResponses = nextRoundResponses;
		}
		return debatedResponses;
	}

	private async synthesizeFinalResponse(originalMessages: ReadonlyArray<LlmMessage>, responses: string[], opts?: GenerateTextOptions): Promise<string> {
		const originalUserQuery = messageText(originalMessages[originalMessages.length - 1]);

		const mediationContextMessages: LlmMessage[] = [
			system(
				`You are a mediator tasked with synthesizing multiple proposed answers to a user query into a single, best possible response.
Review the original query and all proposed answers.
Identify the strongest elements from each, resolve any contradictions, and produce a comprehensive, accurate, and well-reasoned final answer.
Do not explicitly mention the multiple proposals or the mediation process. Directly address the user query.`,
			),
			user(`Original User Query:
<user_query>
${originalUserQuery}
</user_query>

Proposed Answers from Debate:
${responses.map((response, index) => `<proposed_answer_${index + 1}>\n${response}\n</proposed_answer_${index + 1}>`).join('\n\n')}

Synthesize these into the best possible final answer to the Original User Query:`),
		];

		return this.mediatorLLM.generateText(mediationContextMessages, { ...opts, temperature: FINAL_MEDIATION_TEMP, thinking: 'high' });
	}
}
