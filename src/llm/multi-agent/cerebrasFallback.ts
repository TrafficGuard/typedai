import { cerebrasQwen3_235b_Thinking } from '#llm/services/cerebras';
import { openRouterQwen3_235b_Thinking } from '#llm/services/cerebras-openrouter';
import { logger } from '#o11y/logger';
import type { GenerateTextOptions, LLM, LlmMessage } from '#shared/llm/llm.model';
import { BaseLLM } from '../base-llm';

export function cerebrasFallbackRegistry(): Record<string, () => LLM> {
	return {
		'cerebras-fallback:qwen3-235b-thinking': cerebrasFallbackQwen3_235b_Thinking,
	};
}

export function cerebrasFallbackQwen3_235b_Thinking(): LLM {
	return new CerebrasFallback();
}

/**
 */
export class CerebrasFallback extends BaseLLM {
	private llms: LLM[] = [cerebrasQwen3_235b_Thinking(), openRouterQwen3_235b_Thinking()];

	constructor() {
		super({
			displayName: 'Cerebras Qwen3.235b (Thinking) (OpenRouter)',
			service: 'cerebras-fallback',
			modelId: 'cerebras-fallback:qwen3-235b-thinking',
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
		throw new Error('All Cerebras Qwen3.235b (Thinking) providers failed.');
	}
}
