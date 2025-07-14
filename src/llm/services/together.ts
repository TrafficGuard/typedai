import { type TogetherAIProvider, createTogetherAI } from '@ai-sdk/togetherai';
import { fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const TOGETHER_SERVICE = 'together';

export function togetherLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${TOGETHER_SERVICE}:deepseek-ai/DeepSeek-R1`]: () => togetherDeepSeekR1(),
		[`${TOGETHER_SERVICE}:deepseek-ai/DeepSeek-R1-0528-tput`]: () => togetherDeepSeekR1_0528_tput(),
	};
}

// https://www.together.ai/models/deepseek-r1
export function togetherDeepSeekR1(): LLM {
	return new TogetherLLM('DeepSeek R1 (Together fast)', 'deepseek-ai/DeepSeek-R1', 128_000, fixedCostPerMilTokens(3, 7));
}

// https://www.together.ai/models/deepseek-r1-0528-throughput
export function togetherDeepSeekR1_0528_tput(): LLM {
	return new TogetherLLM('DeepSeek R1 (Together cheap)', 'deepseek-ai/DeepSeek-R1-0528-tput', 128_000, fixedCostPerMilTokens(0.55, 2.19));
}

/**
 * Together AI models
 */
export class TogetherLLM extends AiLLM<TogetherAIProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, TOGETHER_SERVICE, model, maxOutputTokens, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser()?.llmConfig.togetheraiKey || process.env.TOGETHERAI_API_KEY;
	}

	provider(): TogetherAIProvider {
		this.aiProvider ??= createTogetherAI({
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}
}
