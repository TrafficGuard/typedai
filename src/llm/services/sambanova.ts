import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { costPerMilTokens } from '#llm/base-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { AiLLM } from './ai-llm';

export const SAMBANOVA_SERVICE = 'sambanova';

export function sambanovaLLMRegistry(): Record<string, () => LLM> {
	return {
		'sambanova:Qwen3-32B': sambanovaQwen3_32b,
		'sambanova:DeepSeek-R1': sambanovaDeepseekR1,
		'sambanova:DeepSeek-V3-0324': sambanovaDeepseekV3,
		'sambanova:DeepSeek-R1-Distill-Llama-70B': sambanovaLlama3_3_70b_R1_Distill,
		'sambanova:Meta-Llama-3.3-70B-Instruct': sambanovaLlama3_3_70b,
	};
}

// https://docs.sambanova.ai/cloud/docs/get-started/supported-models
// https://cloud.sambanova.ai/plans/pricing

export function sambanovaQwen3_32b(): LLM {
	return new SambanovaLLM('Qwen3 32b (Sambanova)', 'Qwen3-32B', 8_192, costPerMilTokens(0.4, 0.8));
}

export function sambanovaDeepseekR1(): LLM {
	return new SambanovaLLM('DeepSeek R1 (Sambanova)', 'DeepSeek-R1', 8_192, costPerMilTokens(5, 7));
}

export function sambanovaDeepseekV3(): LLM {
	return new SambanovaLLM('DeepSeek V3 (Sambanova)', 'DeepSeek-V3-0324', 8_192, costPerMilTokens(1, 1.5));
}

export function sambanovaLlama3_3_70b(): LLM {
	return new SambanovaLLM('Llama 3.3 70b (Sambanova)', 'Meta-Llama-3.3-70B-Instruct', 8_192, costPerMilTokens(0.6, 1.2));
}

export function sambanovaLlama3_3_70b_R1_Distill(): LLM {
	return new SambanovaLLM('Llama 3.3 70b R1 Distill (Sambanova)', 'DeepSeek-R1-Distill-Llama-70B', 128_000, costPerMilTokens(0.7, 1.4));
}

/**
 * https://inference-docs.sambanova.ai/introduction
 */
export class SambanovaLLM extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, SAMBANOVA_SERVICE, model, maxInputTokens, calculateCosts);
	}

	protected provider(): any {
		return createOpenAI({
			apiKey: this.apiKey(),
			baseURL: 'https://api.sambanova.ai/v1',
		});
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.sambanovaKey || process.env.SAMBANOVA_API_KEY;
	}
}
