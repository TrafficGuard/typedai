import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { type InputCostFunction, type OutputCostFunction, perMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { currentUser } from '#user/userService/userContext';
import type { LLM } from '../llm';

export const DEEPINFRA_SERVICE = 'deepinfra';

export class Deepinfra extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxTokens: number, calculateInputCost: InputCostFunction, calculateOutputCost: OutputCostFunction) {
		super(displayName, DEEPINFRA_SERVICE, model, maxTokens, calculateInputCost, calculateOutputCost);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.deepinfraKey?.trim() || process.env.DEEPINFRA_API_KEY;
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
		[`${DEEPINFRA_SERVICE}:Qwen/QwQ-32B-Preview`]: deepinfraQwQ_32B,
		[`${DEEPINFRA_SERVICE}:Qwen/Qwen2.5-Coder-32B-Instruct`]: deepinfraQwen2_5_Coder32B,
		[`${DEEPINFRA_SERVICE}:Qwen/Qwen2.5-72B-Instruct`]: deepinfraQwen2_5_72B,
		[`${DEEPINFRA_SERVICE}:deepseek-ai/DeepSeek-R1`]: deepinfraDeepSeekR1,
		[`${DEEPINFRA_SERVICE}:deepseek-ai/DeepSeek-R1-Distill-Llama-70B`]: deepinfraDeepSeekR1_Distill_Llama70b,
	};
}

// https://deepinfra.com/Qwen/QwQ-32B-Preview
export function deepinfraQwQ_32B(): LLM {
	return new Deepinfra('QwQ-32B-Preview (deepinfra)', 'Qwen/QwQ-32B-Preview', 32_768, perMilTokens(0.15), perMilTokens(0.6));
}

export function deepinfraDeepSeekR1(): LLM {
	return new Deepinfra('DeepSeek R1 (deepinfra)', 'deepseek-ai/DeepSeek-R1', 15_000, perMilTokens(0.85), perMilTokens(2.5));
}

export function deepinfraDeepSeekR1_Distill_Llama70b(): LLM {
	return new Deepinfra('DeepSeek R1 Llama 70b (deepinfra)', 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', 128_000, perMilTokens(0.23), perMilTokens(0.69));
}

// https://deepinfra.com/Qwen/Qwen2.5-Coder-32B-Instruct
export function deepinfraQwen2_5_Coder32B(): LLM {
	return new Deepinfra('Qwen2.5-Coder-32B-Instruct (deepinfra)', 'Qwen/Qwen2.5-Coder-32B-Instruct', 32_768, perMilTokens(0.07), perMilTokens(0.16));
}

// https://deepinfra.com/Qwen/Qwen2.5-72B-Instruct
export function deepinfraQwen2_5_72B(): LLM {
	return new Deepinfra('Qwen2.5-72B-Instruct (deepinfra)', 'Qwen/Qwen2.5-72B-Instruct', 32_768, perMilTokens(0.23), perMilTokens(0.4));
}
