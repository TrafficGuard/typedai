import { cerebrasQwen3_32b } from '#llm/services/cerebras';
import { groqLlama4_Scout } from '#llm/services/groq';
import { vertexGemini_2_5_Flash, vertexGemini_2_5_Flash_Lite } from '#llm/services/vertexai';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { type GenerateTextOptions, type LLM, type LlmMessage, messageContentIfTextOnly, messageText } from '#shared/llm/llm.model';
import { BaseLLM } from '../base-llm';

// https://artificialanalysis.ai/?models_selected=o1-mini%2Cgpt-4o%2Cgpt-4o-mini%2Cllama-3-1-instruct-405b%2Cllama-3-1-instruct-70b%2Cgemini-1-5-pro%2Cgemini-1-5-flash%2Cclaude-35-sonnet%2Cclaude-3-5-haiku%2Cdeepseek-v2-5%2Cqwen2-5-72b-instruct%2Cqwen2-5-coder-32b-instruct&models=groq_llama-4-maverick%2Cgroq_llama-4-scout-instruct%2Cgroq_qwen3-32b-instruct%2Ccerebras_llama-4-scout%2Ccerebras_qwen3-32b-instruct%2Cgemini-2-5-flash%2Cgemini-2-5-flash-lite&endpoints=groq_llama-4-maverick%2Cgroq_llama-4-scout-instruct%2Cgroq_qwen3-32b-instruct%2Ccerebras_llama-4-scout%2Ccerebras_qwen3-32b-instruct

/**
 * LLM implementation for easy level LLM using a fast provider if available and applicable, else falling back to the standard medium LLM
 */
export class FastEasyLLM extends BaseLLM {
	private readonly providers: LLM[];
	private readonly groqScout: LLM;
	private readonly gemini: LLM;

	constructor() {
		super('Fast Easy (Groq Llama Scout - Gemini 2.5 Flash)', 'multi', 'fast-easy', 0, () => ({
			inputCost: 0,
			outputCost: 0,
			totalCost: 0,
		}));
		// Define the providers and their priorities. Lower number = higher priority
		this.providers = [groqLlama4_Scout(), vertexGemini_2_5_Flash()]; // , vertexGemini_2_5_Flash_Lite()
		this.groqScout = this.providers[0];
		this.gemini = this.providers[1];

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

	async useGroqScout(messages: ReadonlyArray<LlmMessage>): Promise<boolean> {
		// if(console.log) return false;
		if (!this.groqScout.isConfigured()) return false;
		let text = '';
		for (const msg of messages) {
			const msgText: string | null = messageContentIfTextOnly(msg);
			if (msgText === null) return false;
			text += `${msgText}\n`;
		}
		const tokens = await countTokens(text);
		return tokens < this.groqScout.getMaxInputTokens();
	}

	override async _generateMessage(messages: ReadonlyArray<LlmMessage>, opts?: GenerateTextOptions): Promise<LlmMessage> {
		try {
			if (await this.useGroqScout(messages)) return await this.groqScout.generateMessage(messages, opts);
		} catch (e) {
			logger.warn(e, `Error calling ${this.groqScout.getId()}`);
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
