import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const DEEPINFRA_SERVICE = 'deepinfra';

export class Deepinfra extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super({ displayName, service: DEEPINFRA_SERVICE, modelId: model, maxInputTokens: maxOutputTokens, calculateCosts });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.deepinfraKey?.trim() || process.env.DEEPINFRA_API_KEY;
	}

	provider(): OpenAIProvider {
		if (!this.aiProvider) {
			const apiKey = this.apiKey();
			if (!apiKey) throw new Error('No API key provided');
			this.aiProvider = createOpenAI({
				apiKey,
				baseURL: 'https://api.deepinfra.com/v1/openai',
			});
		}
		return this.aiProvider;
	}
}
// https://deepinfra.com/models/text-generation
export function deepinfraLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${DEEPINFRA_SERVICE}:Qwen/Qwen3-235B-A22B`]: deepinfraQwen3_235B_A22B,
		[`${DEEPINFRA_SERVICE}:deepseek-ai/DeepSeek-R1-0528`]: deepinfraDeepSeekR1,
		[`${DEEPINFRA_SERVICE}:moonshotai/Kimi-K2-Instruct`]: deepinfraKimiK2,
	};
}

// https://deepinfra.com/Qwen/Qwen3-235B-A22B
export function deepinfraQwen3_235B_A22B(): LLM {
	return new Deepinfra('Qwen3_235B_A22B (deepinfra)', 'Qwen/Qwen3-235B-A22B', 40_960, costPerMilTokens(0.13, 0.6));
}

// https://deepinfra.com/deepseek-ai/DeepSeek-R1-0528
export function deepinfraDeepSeekR1(): LLM {
	return new Deepinfra('DeepSeek R1 (deepinfra)', 'deepseek-ai/DeepSeek-R1-0528', 163_840, costPerMilTokens(0.5, 2.15));
}

// https://deepinfra.com/moonshotai/Kimi-K2-Instruct
export function deepinfraKimiK2(): LLM {
	return new Deepinfra('Kimi-K2-Instruct (deepinfra)', 'moonshotai/Kimi-K2-Instruct', 16384, costPerMilTokens(0.55, 2.2));
}
