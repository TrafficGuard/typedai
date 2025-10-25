import { FireworksProvider, createFireworks } from '@ai-sdk/fireworks';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const FIREWORKS_SERVICE = 'fireworks';

export class Fireworks extends AiLLM<FireworksProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super({ displayName, service: FIREWORKS_SERVICE, modelId: model, maxInputTokens: maxOutputTokens, calculateCosts });
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

export function fireworksLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${FIREWORKS_SERVICE}:accounts/fireworks/models/glm-4p6`]: fireworksGLM_4_6,
	};
}

export function fireworksGLM_4_6(): LLM {
	return new Fireworks('GLM-4.6 (Fireworks)', 'accounts/fireworks/models/glm-4p6', 202_000, costPerMilTokens(0.55, 2.19));
}

export function fireworksDeepSeekR1_Fast(): LLM {
	return new Fireworks('DeepSeek R1 Fast (Fireworks)', 'accounts/fireworks/models/deepseek-r1', 160_000, costPerMilTokens(3, 8));
}
