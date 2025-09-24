import { XaiProvider, createXai } from '@ai-sdk/xai';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const XAI_SERVICE = 'xai';

export class XAI extends AiLLM<XaiProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super({ displayName, service: XAI_SERVICE, modelId: model, maxInputTokens: maxOutputTokens, calculateCosts });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.xaiKey?.trim() || process.env.XAI_API_KEY;
	}

	provider(): XaiProvider {
		if (!this.aiProvider) {
			this.aiProvider = createXai({
				apiKey: this.apiKey() ?? '',
			});
		}
		return this.aiProvider;
	}
}

export function xaiLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${XAI_SERVICE}:grok-4`]: xai_Grok4,
		[`${XAI_SERVICE}:grok-4-fast-reasoning`]: xai_Grok4_Fast_Reasoning,
		[`${XAI_SERVICE}:grok-4-fast-instruct`]: xai_Grok4_Fast_Instruct,
	};
}

export function xai_Grok4(): LLM {
	return new XAI('Grok 4', 'grok-4', 131_072, costPerMilTokens(3, 15, 6, 30, 0.75, 128_000));
}

export function xai_Grok4_Fast_Reasoning(): LLM {
	return new XAI('Grok 4 Fast Reasoning', 'grok-4-fast-reasoning', 2_000_000, costPerMilTokens(0.2, 0.5, 0.5, 1.0, 0.05, 128_000));
}

export function xai_Grok4_Fast_Instruct(): LLM {
	return new XAI('Grok 4 Fast Instruct', 'grok-4-fast-non-reasoning', 2_000_000, costPerMilTokens(0.2, 0.5, 0.5, 1.0, 0.05, 128_000));
}
