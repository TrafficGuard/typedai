import { anthropicClaude4_5_Haiku } from '#llm/services/anthropic';
import { Claude4_5_Haiku_Vertex } from '#llm/services/anthropic-vertex';
import { cerebrasZaiGLM_4_6 } from '#llm/services/cerebras';
import { groqKimiK2 } from '#llm/services/groq';
import { openaiGPT5mini } from '#llm/services/openai';
import { vertexGemini_2_5_Flash } from '#llm/services/vertexai';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { type GenerateTextOptions, type LLM, type LlmMessage, messageContentIfTextOnly, messageText } from '#shared/llm/llm.model';
import { BaseLLM } from '../base-llm';

/**
 * LLM implementation for medium level LLM using a fast provider if available and applicable, else falling back to the standard medium LLM
 * https://artificialanalysis.ai/?models=gemini-2-5-flash%2Cgemini-2-5-flash-reasoning%2Cgroq_qwen3-32b-instruct-reasoning%2Cgroq_qwen3-32b-instruct%2Ccerebras_qwen3-32b-instruct-reasoning&endpoints=groq_qwen3-32b-instruct-reasoning%2Ccerebras_qwen3-235b-a22b-instruct-2507%2Ccerebras_qwen3-235b-a22b-instruct-2507-reasoning%2Ccerebras_qwen3-32b-instruct-reasoning
 */
export class FastMediumLLM extends BaseLLM {
	private readonly providers: LLM[];
	private readonly cerebras = cerebrasZaiGLM_4_6();
	private readonly groq = groqKimiK2();
	private readonly openai = openaiGPT5mini();
	private readonly gemini = vertexGemini_2_5_Flash({ thinking: 'high' });
	private readonly haiku = anthropicClaude4_5_Haiku();
	private readonly vertexHaiku = Claude4_5_Haiku_Vertex();

	constructor() {
		super({
			displayName: 'Fast Medium (Cerebras/Groq Qwen3, Gemini 2.5 Flash, GPT-5 Mini',
			service: 'multi',
			modelId: 'fast-medium',
			maxInputTokens: 0,
			calculateCosts: () => ({
				inputCost: 0,
				outputCost: 0,
				totalCost: 0,
			}),
		});
		this.providers = [this.vertexHaiku, this.haiku, this.cerebras, this.groq, this.gemini, this.openai];
		this.maxInputTokens = Math.max(...this.providers.map((p) => p.getMaxInputTokens()));
	}

	override isConfigured(): boolean {
		return this.providers.findIndex((llm) => !llm.isConfigured()) === -1;
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected override async generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		const message = await this._generateMessage(llmMessages, opts);
		return messageText(message);
	}

	/**
	 * @param messages
	 * @returns the number of tokens, or null if there is non-text messages
	 */
	async textTokens(messages: ReadonlyArray<LlmMessage>): Promise<number | null> {
		let text = '';
		for (const msg of messages) {
			const msgText: string | null = messageContentIfTextOnly(msg);
			if (msgText === null) return null;
			text += `${msgText}\n`;
		}
		return await countTokens(text);
	}

	override async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		opts ??= {};
		opts.thinking = 'high';
		const textOnlyTokens = await this.textTokens(messages);

		try {
			if (textOnlyTokens && this.cerebras.isConfigured() && textOnlyTokens < this.cerebras.getMaxInputTokens() * 0.4)
				return await this.cerebras.generateMessage(messages, opts);
		} catch (e) {
			logger.warn(`Error calling ${this.cerebras.getId()} with ${textOnlyTokens} tokens: ${e.message}`);
		}

		try {
			if (textOnlyTokens && this.groq.isConfigured() && textOnlyTokens < this.groq.getMaxInputTokens() * 0.9)
				return await this.groq.generateMessage(messages, opts);
		} catch (e) {
			logger.warn(`Error calling ${this.groq.getId()} with ${textOnlyTokens} tokens: ${e.message}`);
		}

		try {
			if (this.gemini.isConfigured()) return await this.gemini.generateMessage(messages, opts);
		} catch (e) {
			logger.warn(`Error calling ${this.gemini.getId()} with ${textOnlyTokens} tokens: ${e.message}`);
		}

		if (this.openai.isConfigured()) return await this.openai.generateMessage(messages, opts);

		throw new Error('No configured LLMs for fastMedium');
	}
}
