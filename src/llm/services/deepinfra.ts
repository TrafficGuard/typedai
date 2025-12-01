import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const DEEPINFRA_SERVICE = 'deepinfra';

export class Deepinfra extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super({ displayName, service: DEEPINFRA_SERVICE, modelId: model, maxInputTokens, maxOutputTokens, calculateCosts });
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
export function deepinfraLLMRegistry(): Array<() => LLM> {
	return [];
}
