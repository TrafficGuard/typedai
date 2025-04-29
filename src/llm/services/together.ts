import { type TogetherAIProvider, createTogetherAI } from '@ai-sdk/togetherai';
import type { LanguageModelV1 } from 'ai';
import { type InputCostFunction, type OutputCostFunction, perMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { currentUser } from '#user/userService/userContext';
import type { LLM } from '../llm';

export const TOGETHER_SERVICE = 'together';

export function togetherLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${TOGETHER_SERVICE}:meta-llama/Llama-3-70b-chat-hf`]: () => togetherLlama3_70B(),
		[`${TOGETHER_SERVICE}:deepseek-ai/DeepSeek-R1`]: () => togetherDeepSeekR1(),
		[`${TOGETHER_SERVICE}:deepseek-ai/DeepSeek-R1-Distill-Llama-70B`]: () => togetherLlama3_70B_R1_Distill(),
	};
}

export function togetherLlama3_70B(): LLM {
	return new TogetherLLM('Llama3 70b (Together)', 'meta-llama/Llama-3-70b-chat-hf', 8000, perMilTokens(0.9), perMilTokens(0.9));
}

export function togetherLlama3_70B_R1_Distill(): LLM {
	return new TogetherLLM('Llama3 70b R1 Distill (Together)', 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', 128_000, perMilTokens(2), perMilTokens(2));
}

export function togetherDeepSeekR1(): LLM {
	return new TogetherLLM('DeepSeek R1 (Together)', 'deepseek-ai/DeepSeek-R1', 64000, perMilTokens(3), perMilTokens(7));
}

type TogetherAIProviderV1 = TogetherAIProvider & {
	languageModel: (modelId: string) => LanguageModelV1;
};
/**
 * Together AI models
 */
export class TogetherLLM extends AiLLM<TogetherAIProviderV1> {
	constructor(displayName: string, model: string, maxTokens: number, inputCostPerToken: InputCostFunction, outputCostPerToken: OutputCostFunction) {
		super(displayName, TOGETHER_SERVICE, model, maxTokens, inputCostPerToken, outputCostPerToken);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.togetheraiKey || process.env.TOGETHERAI_API_KEY;
	}

	provider(): TogetherAIProviderV1 {
		// @ts-ignore
		this.aiProvider ??= createTogetherAI({
			apiKey: this.apiKey(),
		});
		this.aiProvider.languageModel = (modelId) => this.aiProvider(modelId);
		return this.aiProvider;
	}
}
