import { FireworksProvider, createFireworks } from '@ai-sdk/fireworks';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const FIREWORKS_SERVICE = 'fireworks';

export function fireworksLLMRegistry(): Array<() => LLM> {
	return [fireworksKimi2thinking];
}

// https://fireworks.ai/models/fireworks/kimi-k2-thinking
export function fireworksKimi2thinking(): LLM {
	return new Fireworks('Kimi 2 Thinking (Fireworks)', 'fireworks/kimi-k2-thinking', 202_000, 16000, costPerMilTokens(0.6, 2.5));
}

export class Fireworks extends AiLLM<FireworksProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super({ displayName, service: FIREWORKS_SERVICE, modelId: model, maxInputTokens, maxOutputTokens, calculateCosts });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.fireworksKey?.trim() || process.env.FIREWORKS_API_KEY;
	}

	provider(): FireworksProvider {
		if (!this.aiProvider) {
			const apiKey = this.apiKey();
			if (!apiKey) throw new Error('No API key provided');
			this.aiProvider = createFireworks({
				apiKey,
				baseURL: 'https://api.fireworks.ai/inference/v1',
			});
		}
		return this.aiProvider;
	}
}
