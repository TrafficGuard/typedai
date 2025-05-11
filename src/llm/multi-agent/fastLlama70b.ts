import { cerebrasLlama3_3_70b } from '#llm/services/cerebras';
import { logger } from '#o11y/logger';
import type { GenerateTextOptions, LLM, LlmMessage } from '#shared/model/llm.model';
import { BaseLLM } from '../base-llm';
import { fireworksLlama3_70B } from '../services/fireworks';
import { groqLlama3_3_70B } from '../services/groq';

/**
 * LLM implementation for Llama 3.3 70b that prioritizes speed and falls back to other providers.
 */
export class MultiLlama3_70B extends BaseLLM {
	private readonly providers: LLM[];

	constructor() {
		super(
			'Llama3.3-70b (Fast)',
			'multi',
			'fast-llama3-70b',
			0, // Initialized later
			() => ({ inputCost: 0, outputCost: 0, totalCost: 0 }),
		);
		// Define the providers and their priorities. Lower number = higher priority
		this.providers = [cerebrasLlama3_3_70b(), groqLlama3_3_70B(), fireworksLlama3_70B()];

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
			const combinedPrompt = messages.map((m) => m.content).join('\n');
			if (combinedPrompt.length > llm.getMaxInputTokens()) {
				logger.warn(`Input tokens exceed limit for ${llm.getDisplayName()}. Trying next provider.`);
				continue;
			}
			try {
				logger.info(`Trying ${llm.getDisplayName()}`);
				return await llm.generateText(messages, opts);
			} catch (error) {
				logger.error(`Error with ${llm.getDisplayName()}: ${error.message}. Trying next provider.`);
			}
		}
		throw new Error('All Llama 3.3 70b providers failed.');
	}
}
