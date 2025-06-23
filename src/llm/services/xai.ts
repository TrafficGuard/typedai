import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const XAI_SERVICE = 'xai';

export class XAI extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, XAI_SERVICE, model, maxOutputTokens, calculateCosts);
	}

	protected apiKey(): string {
		return currentUser().llmConfig.xaiKey || process.env.XAI_API_KEY;
	}

	provider(): OpenAIProvider {
		if (!this.aiProvider) {
			this.aiProvider = createOpenAI({
				apiKey: this.apiKey() ?? '',
				baseURL: 'https://api.x.ai/v1',
			});
		}
		return this.aiProvider;
	}
}

export function xaiLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${XAI_SERVICE}:grok-beta`]: xai_GrokBeta,
	};
}

export function xai_GrokBeta(): LLM {
	return new XAI('Grok beta', 'grok-beta', 131_072, fixedCostPerMilTokens(0.9, 0.9));
}
