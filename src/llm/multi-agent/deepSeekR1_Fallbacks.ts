import { nebiusDeepSeekR1 } from '#llm/services/nebius';
import { sambanovaDeepseekR1 } from '#llm/services/sambanova';
import { togetherDeepSeekR1 } from '#llm/services/together';
import { logger } from '#o11y/logger';
import type { GenerateTextOptions, LLM, LlmMessage } from '#shared/model/llm.model';
import { BaseLLM } from '../base-llm';
import { fireworksDeepSeekR1_Fast } from '../services/fireworks';

export function deepSeekFallbackRegistry(): Record<string, () => LLM> {
	return {
		DeepSeekFallback: DeepSeekR1_Together_Fireworks_Nebius_SambaNova,
	};
}

export function DeepSeekR1_Together_Fireworks_Nebius_SambaNova(): LLM {
	return new DeepSeekR1_Fallbacks();
}

/**
 * LLM implementation for DeepSeek R1 which uses Together.ai and Fireworks.ai for more privacy.
 * Tries Together.ai first as is slightly cheaper, then falls back to Fireworks
 */
export class DeepSeekR1_Fallbacks extends BaseLLM {
	private llms: LLM[] = [togetherDeepSeekR1(), fireworksDeepSeekR1_Fast(), nebiusDeepSeekR1(), sambanovaDeepseekR1()];

	constructor() {
		super(
			'DeepSeek R1 (Together, Fireworks, Nebius, SambaNova)',
			'DeepSeekFallback',
			'deepseek-r1-together-fireworks-nebius-sambanova',
			0, // Initialized later
			() => ({ inputCost: 0, outputCost: 0, totalCost: 0 }),
		);
	}

	protected supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	isConfigured(): boolean {
		return this.llms.findIndex((llm) => !llm.isConfigured()) === -1;
	}

	async generateTextFromMessages(messages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		for (const llm of this.llms) {
			if (!llm.isConfigured()) continue;

			try {
				return await llm.generateText(messages, opts);
			} catch (error) {
				logger.error(`Error with ${llm.getDisplayName()}: ${error.message}. Trying next provider.`);
			}
		}
		throw new Error('All DeepSeek R1 providers failed.');
	}
}
