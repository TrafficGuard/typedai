import { cerebrasQwen3_32b } from '#llm/services/cerebras';
import { vertexGemini_2_5_Flash } from '#llm/services/vertexai';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { type GenerateTextOptions, type LLM, type LlmMessage, messageContentIfTextOnly, messageText } from '#shared/model/llm.model';
import { BaseLLM } from '../base-llm';

/**
 * LLM implementation for medium level LLM using a fast provider if available and applicable, else falling back to the standard medium LLM
 */
export class FastMediumLLM extends BaseLLM {
	private readonly providers: LLM[];
	private readonly cerebras: LLM;
	private readonly gemini: LLM;

	constructor() {
		super(
			'Fast Medium (Cerebras Qwen3 32b - Gemini 2.5 Flash)',
			'multi',
			'fast-medium',
			0, // Initialized later
			() => ({ inputCost: 0, outputCost: 0, totalCost: 0 }),
		);
		// Define the providers and their priorities. Lower number = higher priority
		this.providers = [cerebrasQwen3_32b(), vertexGemini_2_5_Flash()];
		this.cerebras = this.providers[0];
		this.gemini = this.providers[1];

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

	async useCerebras(messages: ReadonlyArray<LlmMessage>): Promise<boolean> {
		if (!this.cerebras.isConfigured()) return false;
		let text = '';
		for (const msg of messages) {
			const msgText: string | null = messageContentIfTextOnly(msg);
			if (msgText === null) return false;
			text += `${msgText}\n`;
		}
		const tokens = await countTokens(text);
		logger.info(`====== Cerebras tokens: ${tokens}`);
		return tokens < this.cerebras.getMaxInputTokens() * 0.5;
	}

	async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		try {
			if (await this.useCerebras(messages)) return await this.cerebras.generateMessage(messages, opts);
		} catch (e) {
			logger.warn(e, `Error calling ${this.cerebras.getId()}`);
		}
		return await this.gemini.generateMessage(messages, opts);

		// for (const llm of this.providers) {
		// 	if (!llm.isConfigured()) {
		// 		logger.info(`${llm.getId()} is not configured`);
		// 		continue;
		// 	}
		//
		// 	const combinedPrompt = messages.map((m) => m.content).join('\n');
		// 	const promptTokens = await countTokens(combinedPrompt);
		// 	if (promptTokens > llm.getMaxInputTokens()) {
		// 		logger.info(`Input tokens exceed limit for ${llm.getDisplayName()}. Trying next provider.`);
		// 		continue;
		// 	}
		// 	try {
		// 		logger.info(`Trying ${llm.getDisplayName()}`);
		// 		return await llm.generateText(messages, opts);
		// 	} catch (error) {
		// 		logger.error(`Error with ${llm.getDisplayName()}: ${error.message}. Trying next provider.`);
		// 	}
		// }
	}
}
