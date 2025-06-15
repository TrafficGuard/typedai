import { cerebrasQwen3_32b } from '#llm/services/cerebras';
import { groqQwen3_32b } from '#llm/services/groq';
import { vertexGemini_2_5_Flash_Thinking } from '#llm/services/vertexai';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { type GenerateTextOptions, type LLM, type LlmMessage, messageContentIfTextOnly, messageText } from '#shared/llm/llm.model';
import { BaseLLM } from '../base-llm';

/**
 * LLM implementation for medium level LLM using a fast provider if available and applicable, else falling back to the standard medium LLM
 * https://artificialanalysis.ai/?models_selected=o1-mini%2Cgpt-4o%2Cgpt-4o-mini%2Cllama-3-1-instruct-405b%2Cllama-3-1-instruct-70b%2Cgemini-1-5-pro%2Cgemini-1-5-flash%2Cclaude-35-sonnet%2Cclaude-3-5-haiku%2Cdeepseek-v2-5%2Cqwen2-5-72b-instruct%2Cqwen2-5-coder-32b-instruct&models=gemini-2-5-flash%2Cgemini-2-5-flash-reasoning%2Ccerebras_qwen3-32b-instruct-reasoning%2Csambanova_llama-4-maverick%2Csambanova_deepseek-v3-0324%2Csambanova_qwen3-32b-instruct-reasoning&endpoints=cerebras_qwen3-32b-instruct-reasoning%2Csambanova_llama-4-maverick%2Csambanova_deepseek-v3-0324%2Csambanova_qwen3-32b-instruct-reasoning
 */
export class FastMediumLLM extends BaseLLM {
	private readonly providers: LLM[];
	private readonly cerebras: LLM;
	private readonly groq: LLM;
	private readonly gemini: LLM;

	constructor() {
		super('Fast Medium (Qwen3 32b (Cerebras/Groq - Gemini 2.5 Flash)', 'multi', 'fast-medium', 0, () => ({
			inputCost: 0,
			outputCost: 0,
			totalCost: 0,
		}));
		this.providers = [cerebrasQwen3_32b(), groqQwen3_32b(), vertexGemini_2_5_Flash_Thinking()];
		this.cerebras = this.providers[0];
		this.groq = this.providers[1];
		this.gemini = this.providers[2];

		this.maxInputTokens = Math.max(...this.providers.map((p) => p.getMaxInputTokens()));
	}

	isConfigured(): boolean {
		return this.providers.findIndex((llm) => !llm.isConfigured()) === -1;
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	protected async generateTextFromMessages(llmMessages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
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

	async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		opts ??= {};
		opts.thinking = 'high';
		try {
			const tokens = await this.textTokens(messages);
			if (tokens) {
				if (this.cerebras.isConfigured() && tokens < this.cerebras.getMaxInputTokens() * 0.5) return await this.cerebras.generateMessage(messages, opts);
				if (this.groq.isConfigured() && tokens < this.groq.getMaxInputTokens()) return await this.groq.generateMessage(messages, opts);
			} else {
				logger.info('non-text messages, skipping cerebras/groq');
			}
		} catch (e) {
			logger.warn(e, 'Error calling fast medium LLM');
		}
		return await this.gemini.generateMessage(messages, opts);
	}
}
