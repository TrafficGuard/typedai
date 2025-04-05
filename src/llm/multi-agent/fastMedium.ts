import { cerebrasLlama3_3_70b } from '#llm/services/cerebras';
import { sambanovaLlama3_3_70b } from '#llm/services/sambanova';
import { Gemini_2_0_Flash } from '#llm/services/vertexai';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { BaseLLM } from '../base-llm';
import { GenerateTextOptions, LLM, LlmMessage } from '../llm';

/**
 * LLM implementation for the fastest ~70b level models with fallbacks
 * https://artificialanalysis.ai/?models_selected=o1-mini&models=gemini-2-0-flash%2Cgroq_llama-3-3-instruct-70b%2Cgroq_deepseek-r1-distill-llama-70b%2Cgroq_deepseek-r1-distill-qwen-32b%2Cgroq_qwq-32b%2Ccerebras_llama-3-3-instruct-70b%2Ccerebras_deepseek-r1-distill-llama-70b%2Csambanova_llama-3-3-instruct-70b%2Csambanova_deepseek-r1-distill-llama-70b%2Csambanova_qwen2-5-72b-instruct%2Csambanova_qwq-32b&endpoints=cerebras_llama-3-3-instruct-70b%2Cfireworks_llama-3-3-instruct-70b%2Cgroq_llama-3-3-instruct-70b_spec-decoding%2Cgroq_llama-3-3-instruct-70b%2Csambanova_llama-3-3-instruct-70b%2Ctogetherai_llama-3-3-instruct-70b#intelligence-vs-output-speed
 */
export class FastMediumLLM extends BaseLLM {
	private readonly providers: LLM[];

	constructor() {
		super(
			'Fast Medium',
			'multi',
			'fast-medium',
			0, // Initialized later
			() => 0,
			() => 0,
		);
		// Define the providers and their priorities. Lower number = higher priority
		this.providers = [cerebrasLlama3_3_70b(), sambanovaLlama3_3_70b(), Gemini_2_0_Flash()];

		this.maxInputTokens = Math.max(...this.providers.map((p) => p.getMaxInputTokens()));
	}

	isConfigured(): boolean {
		return this.providers.findIndex((llm) => !llm.isConfigured()) === -1;
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	async generateTextFromMessages(messages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		for (const llm of this.providers) {
			if (!llm.isConfigured()) {
				logger.info(`${llm.getId()} is not configured`);
				continue;
			}

			const combinedPrompt = messages.map((m) => m.content).join('\n');
			const promptTokens = await countTokens(combinedPrompt);
			if (promptTokens > llm.getMaxInputTokens()) {
				logger.info(`Input tokens exceed limit for ${llm.getDisplayName()}. Trying next provider.`);
				continue;
			}
			try {
				logger.info(`Trying ${llm.getDisplayName()}`);
				return await llm.generateText(messages, opts);
			} catch (error) {
				logger.error(`Error with ${llm.getDisplayName()}: ${error.message}. Trying next provider.`);
			}
		}
		throw new Error('All providers failed.');
	}
}
