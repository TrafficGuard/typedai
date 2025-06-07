import { BaseLLM } from '#llm/base-llm';
import { getLLM } from '#llm/llmFactory';
import { Claude4_Opus_Vertex, Claude4_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { cerebrasQwen3_32b } from '#llm/services/cerebras';
import { deepinfraDeepSeekR1 } from '#llm/services/deepinfra';
import { deepSeekR1, deepSeekV3 } from '#llm/services/deepseek';
import { Gemini_2_5_Pro } from '#llm/services/gemini';
import { openAIo3, openAIo4mini } from '#llm/services/openai';
import { vertexGemini_2_5_Pro } from '#llm/services/vertexai';
import { logger } from '#o11y/logger';
import { type GenerateTextOptions, type LLM, type LlmMessage, lastText } from '#shared/llm/llm.model';

// sparse multi-agent debate https://arxiv.org/abs/2406.11776

export function MoA_reasoningLLMRegistry(): Record<string, () => LLM> {
	return {
		'MAD:Cost': MAD_Cost,
		'MAD:Fast': MAD_Fast,
		'MAD:SOTA': MAD_SOTA,
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
	return new ReasonerDebateLLM(
		'Fast',
		cerebrasQwen3_32b,
		[cerebrasQwen3_32b, cerebrasQwen3_32b, cerebrasQwen3_32b],
		'MAD:Fast multi-agent debate (Cerebras Qwen3 32b)',
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
		const readOnlyMessages = llmMessages as ReadonlyArray<Readonly<LlmMessage>>;
		logger.info('Generating initial responses');
		const initialResponses: string[] = await this.generateInitialResponses(readOnlyMessages, opts);
		logger.info('Debating responses');
		const debatedResponses = await this.multiAgentDebate(readOnlyMessages, initialResponses, opts);
		logger.info('Mediating response');
		return { role: 'assistant', content: await this.mergeBestResponses(readOnlyMessages, debatedResponses) };
	}

	private async generateInitialResponses(llmMessages: ReadonlyArray<Readonly<LlmMessage>>, opts?: GenerateTextOptions): Promise<string[]> {
		return Promise.all(this.llms.map((llm) => llm.generateText(llmMessages, { ...opts, temperature: INITIAL_TEMP, thinking: 'high' })));
	}

	private async multiAgentDebate(
		llmMessages: ReadonlyArray<Readonly<LlmMessage>>,
		responses: string[],
		opts?: GenerateTextOptions,
		rounds = 2,
	): Promise<string[]> {
		opts.temperature = DEBATE_TEMP;
		let debatedResponses = responses;
		const userMessage = lastText(llmMessages);
		for (let round = 1; round < rounds; round++) {
			logger.info(`Round ${round}...`);
			debatedResponses = await Promise.all(
				this.llms.map((llm, index) => {
					const leftNeighborIndex = (index - 1 + this.llms.length) % this.llms.length;
					const rightNeighborIndex = (index + 1) % this.llms.length;
					const newUserPrompt = `<user-message>\n${userMessage}\n</user-message>\n\n<initial-response>\n${responses[index]}\n</initial-response>\n
Following are responses generated by other assistants:\n<assistant-response-1>\n${responses[leftNeighborIndex]}\n</assistant-response-1>\n\n<assistant-response-2>\n${responses[rightNeighborIndex]}\n</assistant-response-2>\n
Use the insights from all the responses to refine and update your response to the user message.
Do not mention the multiple responses provided.
Ensure any relevant response formatting instructions are followed.`;

					const debateMessages: LlmMessage[] = [...llmMessages];
					debateMessages[debateMessages.length - 1] = { role: 'user', content: newUserPrompt };
					// const debateMessages: LlmMessage[] = [...llmMessages, { role: 'user', content: newUserPrompt }];
					return llm.generateText(debateMessages, opts);
				}),
			);
		}

		return debatedResponses;
	}

	private async mergeBestResponses(
		llmMessages: ReadonlyArray<Readonly<LlmMessage>>,
		responses: string[],
		systemPrompt?: string,
		opts?: GenerateTextOptions,
	): Promise<string> {
		// TODO convert content to string
		const originalMessage = lastText(llmMessages);
		const mergePrompt = `<user-message>\n${originalMessage}\n</user-message>

Following are responses generated by other assistants:
${responses.map((response, index) => `<assistant-response-${index + 1}>\n${response}\n</assistant-response-${index + 1}>`).join('\n\n')}
        
Look at the <user-message> again and use the insights from all the assistant responses to provide a final response. Do not mention the multiple responses provided.
Answer directly to the original user message and ensure any relevant response formatting instructions are followed.
        `;
		const mergedMessages: LlmMessage[] = [...llmMessages];
		mergedMessages[mergedMessages.length - 1] = { role: 'user', content: mergePrompt };
		const generation = this.mediator.generateText(mergedMessages, { ...opts, temperature: FINAL_TEMP, thinking: 'high' });
		logger.info('Merging best response...');
		return await generation;
	}
}
