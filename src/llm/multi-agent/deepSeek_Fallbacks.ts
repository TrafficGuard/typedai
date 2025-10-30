import { nebiusDeepSeekR1 } from '#llm/services/nebius';
import { sambanovaDeepseekR1 } from '#llm/services/sambanova';
import { togetherDeepSeekR1 } from '#llm/services/together';
import { logger } from '#o11y/logger';
import type { GenerateTextOptions, LLM, LlmMessage } from '#shared/llm/llm.model';
import { BaseLLM } from '../base-llm';
import { fireworksDeepSeekR1_Fast } from '../services/fireworks';

/**
 * LLM implementation for DeepSeek which uses Together.ai and Fireworks.ai for more privacy.
 * Tries Together.ai first as is slightly cheaper, then falls back to Fireworks
 */
export class DeepSeek_Fallbacks extends BaseLLM {
	private llms: LLM[] = [togetherDeepSeekR1(), fireworksDeepSeekR1_Fast(), nebiusDeepSeekR1(), sambanovaDeepseekR1()];

	constructor() {
		super({
			displayName: 'DeepSeek (Together, Fireworks, Nebius, SambaNova)',
			service: 'DeepSeekFallback',
			modelId: 'deepseek-together-fireworks-nebius-sambanova',
			maxInputTokens: 0,
			calculateCosts: () => ({
				inputCost: 0,
				outputCost: 0,
				totalCost: 0,
			}),
		});
	}

	protected override supportsGenerateTextFromMessages(): boolean {
		return true;
	}

	override isConfigured(): boolean {
		return this.llms.findIndex((llm) => !llm.isConfigured()) === -1;
	}

	override async generateTextFromMessages(messages: LlmMessage[], opts?: GenerateTextOptions): Promise<string> {
		for (const llm of this.llms) {
			if (!llm.isConfigured()) continue;

			try {
				return await llm.generateText(messages, opts);
			} catch (error) {
				logger.error(`Error with ${llm.getDisplayName()}: ${error.message}. Trying next provider.`);
			}
		}
		throw new Error('All DeepSeek providers failed.');
	}
}

export function deepSeekFallbackRegistry(): Array<() => LLM> {
	return [DeepSeek_Together_Fireworks_Nebius_SambaNova];
}

export function DeepSeek_Together_Fireworks_Nebius_SambaNova(): LLM {
	return new DeepSeek_Fallbacks();
}
