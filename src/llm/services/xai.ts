import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { type InputCostFunction, type OutputCostFunction, perMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import { currentUser } from '#user/userService/userContext';
import type { LLM } from '../llm';

export const XAI_SERVICE = 'xai';

export class XAI extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxTokens: number, calculateInputCost: InputCostFunction, calculateOutputCost: OutputCostFunction) {
		super(displayName, XAI_SERVICE, model, maxTokens, calculateInputCost, calculateOutputCost);
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
	return new XAI('Grok beta', 'grok-beta', 131_072, perMilTokens(0.9), perMilTokens(0.9));
}
