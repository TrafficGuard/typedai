import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { type LlmCostFunction, fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { currentUser } from '#user/userService/userContext';
import type { LLM } from '../llm';

export const FIREWORKS_SERVICE = 'fireworks';

export class Fireworks extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, FIREWORKS_SERVICE, model, maxTokens, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.fireworksKey?.trim() || process.env.FIREWORKS_API_KEY;
	}

	provider(): OpenAIProvider {
		if (!this.aiProvider) {
			const apiKey = this.apiKey();
			if (!apiKey) throw new Error('No API key provided');
			this.aiProvider = createOpenAI({
				apiKey,
				baseURL: 'https://api.fireworks.ai/inference/v1',
			});
		}
		return this.aiProvider;
	}
}

export function fireworksLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${FIREWORKS_SERVICE}:accounts/fireworks/models/llama-v3p1-70b-instruct`]: fireworksLlama3_70B,
		[`${FIREWORKS_SERVICE}:accounts/fireworks/models/llama-v3p1-405b-instruct`]: fireworksLlama3_405B,
		[`${FIREWORKS_SERVICE}:accounts/fireworks/models/deepseek-v3`]: fireworksDeepSeekV3,
		// [`${FIREWORKS_SERVICE}:accounts/fireworks/models/deepseek-r1-distill-llama-70b`]: fireworksLlama3_70B_R1_Distill,
	};
}

export function fireworksLlama3_70B(): LLM {
	return new Fireworks('LLama3 70b-i (Fireworks)', 'accounts/fireworks/models/llama-v3p1-70b-instruct', 131_072, fixedCostPerMilTokens(0.9, 0.9));
}

export function fireworksLlama3_405B(): LLM {
	return new Fireworks('LLama3 405b-i (Fireworks)', 'accounts/fireworks/models/llama-v3p1-405b-instruct', 131_072, fixedCostPerMilTokens(3, 3));
}

export function fireworksDeepSeekV3(): LLM {
	return new Fireworks('DeepSeek 3 (Fireworks)', 'accounts/fireworks/models/deepseek-v3', 131_072, fixedCostPerMilTokens(0.9, 0.9));
}

export function fireworksDeepSeekR1(): LLM {
	return new Fireworks('DeepSeek R1 (Fireworks)', 'accounts/fireworks/models/deepseek-r1', 160_000, fixedCostPerMilTokens(3, 8));
}

// Not available in serverless
// export function fireworksLlama3_70B_R1_Distill(): LLM {
// 	return new Fireworks('LLama3 70b R1 Distill (Fireworks)', 'accounts/fireworks/models/deepseek-r1-distill-llama-70b', 131_072, perMilTokens(0.9), perMilTokens(0.9));
// }
