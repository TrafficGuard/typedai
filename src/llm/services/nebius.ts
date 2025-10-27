import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const NEBIUS_SERVICE = 'nebius';

export function nebiusLLMRegistry(): Array<() => LLM> {
	return [nebiusDeepSeekR1];
}

export function nebiusDeepSeekR1(): LLM {
	return new NebiusLLM('DeepSeek R1 (Nebius)', 'deepseek-ai/DeepSeek-R1', costPerMilTokens(0.8, 2.4));
}

export class NebiusLLM extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, calculateCosts: LlmCostFunction) {
		super({ displayName, service: NEBIUS_SERVICE, modelId: model, maxInputTokens: 128_000, calculateCosts });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.nebiusKey?.trim() || process.env.NEBIUS_API_KEY;
	}

	provider(): OpenAIProvider {
		this.aiProvider ??= createOpenAI({
			baseURL: 'https://api.studio.nebius.ai/v1/',
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}
}
