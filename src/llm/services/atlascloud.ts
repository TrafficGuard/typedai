import { type OpenAIProvider, createOpenAI } from '@ai-sdk/openai';
import { costPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const ATLASCLOUD_SERVICE = 'atlascloud';

export function atlasCloudLLMRegistry(): Array<() => LLM> {
	return [atlasCloudDeepSeekV31Terminus, atlasCloudGLM47, atlasCloudKimiK26];
}

// Context windows and prices read from the gateway's public catalog
// (GET https://api.atlascloud.ai/v1/models) on 2026-10-05.
export function atlasCloudDeepSeekV31Terminus(): LLM {
	return new AtlasCloudLLM('DeepSeek V3.1 Terminus (Atlas Cloud)', 'deepseek-ai/DeepSeek-V3.1-Terminus', 131_072, costPerMilTokens(0.3, 0.95));
}

export function atlasCloudGLM47(): LLM {
	return new AtlasCloudLLM('GLM 4.7 (Atlas Cloud)', 'zai-org/glm-4.7', 202_752, costPerMilTokens(0.52, 1.85));
}

export function atlasCloudKimiK26(): LLM {
	return new AtlasCloudLLM('Kimi K2.6 (Atlas Cloud)', 'moonshotai/kimi-k2.6', 262_144, costPerMilTokens(0.95, 4.0));
}

export class AtlasCloudLLM extends AiLLM<OpenAIProvider> {
	constructor(displayName: string, model: string, maxInputTokens: number, calculateCosts: LlmCostFunction) {
		super({ displayName, service: ATLASCLOUD_SERVICE, modelId: model, maxInputTokens, calculateCosts });
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.atlasCloudKey?.trim() || process.env.ATLASCLOUD_API_KEY;
	}

	provider(): OpenAIProvider {
		this.aiProvider ??= createOpenAI({
			baseURL: 'https://api.atlascloud.ai/v1',
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}
}
