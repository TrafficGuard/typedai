import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { type LlmCostFunction, fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const NEBIUS_SERVICE = 'nebius';

export function nebiusLLMRegistry(): Record<string, () => LLM> {
	return {
		'nebius:deepseek-ai/DeepSeek-R1': nebiusDeepSeekR1,
	};
}

export function nebiusDeepSeekR1() {
	return new NebiusLLM('DeepSeek R1 (Nebius)', 'deepseek-ai/DeepSeek-R1', fixedCostPerMilTokens(0.8, 2.4));
}

export class NebiusLLM extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, calculateCosts: LlmCostFunction) {
		super(displayName, NEBIUS_SERVICE, model, 128_000, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.nebiusKey || process.env.NEBIUS_API_KEY;
	}

	provider(): OpenAIProvider {
		this.aiProvider ??= createOpenAI({
			baseURL: 'https://api.studio.nebius.ai/v1/',
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}
}
