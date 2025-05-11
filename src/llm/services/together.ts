import { type TogetherAIProvider, createTogetherAI } from '@ai-sdk/togetherai';
import { type LlmCostFunction, fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM } from '#shared/model/llm.model';
import { currentUser } from '#user/userContext';

export const TOGETHER_SERVICE = 'together';

export function togetherLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${TOGETHER_SERVICE}:meta-llama/Llama-3-70b-chat-hf`]: () => togetherLlama3_70B(),
		[`${TOGETHER_SERVICE}:deepseek-ai/DeepSeek-R1`]: () => togetherDeepSeekR1(),
		[`${TOGETHER_SERVICE}:deepseek-ai/DeepSeek-R1-Distill-Llama-70B`]: () => togetherLlama3_70B_R1_Distill(),
	};
}

export function togetherLlama3_70B(): LLM {
	return new TogetherLLM('Llama3 70b (Together)', 'meta-llama/Llama-3-70b-chat-hf', 8000, fixedCostPerMilTokens(0.9, 0.9));
}

export function togetherLlama3_70B_R1_Distill(): LLM {
	return new TogetherLLM('Llama3 70b R1 Distill (Together)', 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', 128_000, fixedCostPerMilTokens(2, 2));
}

export function togetherDeepSeekR1(): LLM {
	return new TogetherLLM('DeepSeek R1 (Together)', 'deepseek-ai/DeepSeek-R1', 64000, fixedCostPerMilTokens(3, 7));
}

/**
 * Together AI models
 */
export class TogetherLLM extends AiLLM<TogetherAIProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, TOGETHER_SERVICE, model, maxOutputTokens, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.togetheraiKey || process.env.TOGETHERAI_API_KEY;
	}

	provider(): TogetherAIProvider {
		this.aiProvider ??= createTogetherAI({
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}
}
