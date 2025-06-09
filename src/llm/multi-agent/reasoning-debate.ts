import { BaseLLM } from '#llm/base-llm';
import { getLLM } from '#llm/llmFactory';
import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { Claude4_Opus_Vertex, Claude4_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { deepinfraDeepSeekR1 } from '#llm/services/deepinfra';
import { openAIo3, openAIo4mini } from '#llm/services/openai';
import { vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import { logger } from '#o11y/logger';
import {
	type AssistantContentExt,
	type GenerateTextOptions,
	type GenerationStats,
	type LLM,
	type LlmMessage,
	lastText,
	messageText,
} from '#shared/llm/llm.model';

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

// Helper function to add stats from one GenerationStats object to an accumulator
function accumulateStats(accumulator: GenerationStats, newStats?: GenerationStats): void {
	if (!newStats) return;

	accumulator.requestTime += newStats.requestTime || 0;
	accumulator.timeToFirstToken += newStats.timeToFirstToken || 0; // Summing timeToFirstToken as per generic "sum" request
	accumulator.totalTime += newStats.totalTime || 0;
	accumulator.inputTokens += newStats.inputTokens || 0;
	accumulator.outputTokens += newStats.outputTokens || 0;
	accumulator.cachedInputTokens = (accumulator.cachedInputTokens || 0) + (newStats.cachedInputTokens || 0);
	accumulator.cost = (accumulator.cost || 0) + (newStats.cost || 0); // Treats null cost as 0 for summation
	// accumulator.llmId remains the ID of the composite LLM.
}

// sparse multi-agent debate https://arxiv.org/abs/2406.11776

export function MoA_reasoningLLMRegistry(): Record<string, () => LLM> {
	return {
		'MAD:Cost': MAD_Cost,
		'MAD:Fast': MAD_Fast,
		'MAD:SOTA': MAD_SOTA,
		'MAD:Balanced': MAD_Balanced,
	};
}

export function MAD_Cost(): LLM {
	return new ReasonerDebateLLM(
		'Cost',
		deepinfraDeepSeekR1,
		[deepinfraDeepSeekR1, deepinfraDeepSeekR1, deepinfraDeepSeekR1],
		'MAD:Cost multi-agent debate (DeepSeek R1x3)',
	);
}

export function MAD_Fast(): LLM {
	const fastMedium = new FastMediumLLM();
	const fastMediumFactory = () => fastMedium;
	return new ReasonerDebateLLM(
		'Fast',
		fastMediumFactory,
		[fastMediumFactory, fastMediumFactory, fastMediumFactory],
		'MAD:Fast multi-agent debate (Cerebras Qwen3 32b, Flash 2.5 fallback)',
	);
}

export function MAD_Balanced(): LLM {
	return new ReasonerDebateLLM(
		'Balanced',
		vertexGemini_2_5_Pro,
		[vertexGemini_2_5_Pro, Claude4_Sonnet_Vertex, openAIo4mini],
		'MAD:Balanced multi-agent debate (Gemini 2.5 Pro, Sonnet 4, o4-mini)',
	);
}

export function MAD_SOTA(): LLM {
	return new ReasonerDebateLLM(
		'SOTA',
		openAIo3,
		[openAIo3, Claude4_Opus_Vertex, vertexGemini_2_5_Pro],
		'MAD:SOTA multi-agent debate (Opus 4, o3, Gemini 2.5 Pro)',
	);
}

const INITIAL_TEMP = 0.7;
const DEBATE_TEMP = 0.5;
const FINAL_TEMP = 0.3;

/**
 * Multi-agent debate (spare communication topology) implementation with simple prompts for reasoning LLMs
 * @constructor
 */
export class ReasonerDebateLLM extends BaseLLM {
	llms: LLM[];
	mediator: LLM;

	/**
	 *
	 * @param modelIds LLM model ids to use seperated by the pipe character. The first id will be used as the mediator. The remaining will be used as the initial response/debate generation.
	 * @param providedMediator
	 * @param providedDebateLLMs
	 * @param name
	 */
	constructor(modelIds = '', providedMediator?: () => LLM, providedDebateLLMs?: Array<() => LLM>, name?: string) {
		super(name ?? '(MoA)', 'MAD', modelIds, 200_000, () => ({ inputCost: 0, outputCost: 0, totalCost: 0 }));
		if (providedMediator) this.mediator = providedMediator();
		if (providedDebateLLMs) {
			this.llms = providedDebateLLMs.map((factory) => factory());
			// this.model = this.llms.map((llm) => llm.)
		}
		if (modelIds?.includes('|')) {
			this.model = modelIds;
			try {
				const parts = modelIds.split('|');
				if (parts.length > 1) {
					// Set the mediator
					this.mediator = getLLM(parts[0]);

					// Set the LLMs
					this.llms = parts.slice(1).map((llmId) => getLLM(llmId));
				} else {
					throw new Error();
				}
			} catch (e) {
				throw new Error(`Invalid model string format for MoA ${modelIds}`);
			}
		}
	}

	isConfigured(): boolean {
		for (const llm of this.llms) {
			if (!llm.isConfigured()) logger.warn(`${llm.getId()} is not configured`);
		}
		if (!this.mediator.isConfigured()) logger.warn(`Mediator ${this.mediator.getId()} is not configured`);
		// return this.mediator.isConfigured() && this.llms.findIndex((llm) => !llm.isConfigured()) === -1;
		return true;
	}

	getModel(): string {
		return `${this.mediator.getId()}|${this.llms.map((llm) => llm.getId()).join('|')}`;
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected async _generateMessage(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<LlmMessage> {
		opts.thinking = 'high';
		const readOnlyMessages = llmMessages as ReadonlyArray<Readonly<LlmMessage>>;
		const totalStats: GenerationStats = createEmptyStats(this.getId());

		logger.info('Generating initial responses');
		const initialResponseMessages = await this.generateInitialResponses(readOnlyMessages, opts);
		initialResponseMessages.forEach((msg) => accumulateStats(totalStats, msg.stats));

		logger.info('Debating responses');
		const debatedResponseMessages = await this.multiAgentDebate(readOnlyMessages, initialResponseMessages, opts);
		debatedResponseMessages.forEach((msg) => accumulateStats(totalStats, msg.stats));

		logger.info('Mediating response');
		const finalMergedMessage = await this.mergeBestResponses(readOnlyMessages, debatedResponseMessages, opts);
		accumulateStats(totalStats, finalMergedMessage.stats);

		return {
			role: 'assistant',
			content: finalMergedMessage.content as AssistantContentExt,
			stats: totalStats,
		};
	}

	private async generateInitialResponses(llmMessages: ReadonlyArray<Readonly<LlmMessage>>, opts?: GenerateTextOptions): Promise<LlmMessage[]> {
		return Promise.all(this.llms.map((llm) => llm.generateMessage(llmMessages, { ...opts, temperature: INITIAL_TEMP, thinking: 'high' })));
	}

	private async multiAgentDebate(
		llmMessages: ReadonlyArray<Readonly<LlmMessage>>,
		initialMessages: ReadonlyArray<LlmMessage>, // Changed from responses: string[]
		opts?: GenerateTextOptions,
		rounds = 2,
	): Promise<LlmMessage[]> {
		const effectiveOpts = { ...opts, temperature: DEBATE_TEMP };
		let currentRoundMessages: ReadonlyArray<LlmMessage> = initialMessages;
		const userMessageContent = lastText(llmMessages); // Original user message text

		for (let round = 1; round <= rounds; round++) {
			// Adjusted loop to run `rounds` times for debate
			logger.info(`Debate Round ${round}...`);
			const nextRoundMessagePromises = this.llms.map((llm, index) => {
				const ownInitialResponseText = messageText(initialMessages[index]); // Agent's own initial response
				const leftNeighborResponseText = messageText(currentRoundMessages[(index - 1 + this.llms.length) % this.llms.length]);
				const rightNeighborResponseText = messageText(currentRoundMessages[(index + 1) % this.llms.length]);

				const newUserPrompt = `<user-message>\n${userMessageContent}\n</user-message>\n\n<initial-response>\n${ownInitialResponseText}\n</initial-response>\n
Following are responses generated by other assistants from the previous round:\n<assistant-response-1>\n${leftNeighborResponseText}\n</assistant-response-1>\n\n<assistant-response-2>\n${rightNeighborResponseText}\n</assistant-response-2>\n
Use the insights from your initial response and the other assistants' responses to refine and update your response to the user message.
Do not mention the multiple responses provided or the debate process.
Ensure any relevant response formatting instructions from the original user message are followed.`;

				const debateMessages: LlmMessage[] = [...llmMessages]; // Copy of original messages
				debateMessages[debateMessages.length - 1] = { role: 'user', content: newUserPrompt }; // Replace last user message
				return llm.generateMessage(debateMessages, effectiveOpts);
			});
			currentRoundMessages = await Promise.all(nextRoundMessagePromises);
		}
		return currentRoundMessages as LlmMessage[]; // Cast because ReadonlyArray<LlmMessage>
	}

	private async mergeBestResponses(
		llmMessages: ReadonlyArray<Readonly<LlmMessage>>,
		debatedMessages: ReadonlyArray<LlmMessage>, // Changed from responses: string[]
		opts?: GenerateTextOptions,
	): Promise<LlmMessage> {
		const originalUserMessageContent = lastText(llmMessages);
		const mergePrompt = `<user-message>\n${originalUserMessageContent}\n</user-message>

Following are responses generated by multiple assistants after a debate process:
${debatedMessages.map((responseMsg, index) => `<assistant-response-${index + 1}>\n${messageText(responseMsg)}\n</assistant-response-${index + 1}>`).join('\n\n')}
        
Look at the original <user-message> again. Use the insights from all the assistant responses to synthesize a final, comprehensive, and high-quality response.
Do not mention the multiple responses or the debate process.
Answer directly to the original user message and ensure any relevant response formatting instructions are followed.`;

		const mergedMessages: LlmMessage[] = [...llmMessages]; // Copy of original messages
		mergedMessages[mergedMessages.length - 1] = { role: 'user', content: mergePrompt }; // Replace last user message

		logger.info('Merging best response with mediator...');
		return this.mediator.generateMessage(mergedMessages, { ...opts, temperature: FINAL_TEMP, thinking: 'high' });
	}
}
