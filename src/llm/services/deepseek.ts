import { type DeepSeekProvider, createDeepSeek } from '@ai-sdk/deepseek';
import { costPerMilTokens } from '#llm/base-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { AiLLM } from './ai-llm';

export const DEEPSEEK_SERVICE = 'deepseek';

export function deepseekLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${DEEPSEEK_SERVICE}:deepseek-chat`]: deepSeekV3_1,
		[`${DEEPSEEK_SERVICE}:deepseek-reasoner`]: deepSeekV3_1_Reasoning,
	};
}

// https://api-docs.deepseek.com/quick_start/pricing

export function deepSeekV3_1(): LLM {
	return new DeepSeekLLM('DeepSeek 3.1', 'deepseek-chat', 64_000, costPerMilTokens(0.56, 1.68, 0.07));
}

export function deepSeekV3_1_Reasoning(): LLM {
	return new DeepSeekLLM('DeepSeek 3.1 Reasoning', 'deepseek-reasoner', 64_000, costPerMilTokens(0.56, 1.68, 0.07));
}

/**
 * Deepseek models
 * @see https://platform.deepseek.com/api-docs/api/create-chat-completion
 */
export class DeepSeekLLM extends AiLLM<DeepSeekProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, DEEPSEEK_SERVICE, model, maxOutputTokens, calculateCosts);
	}

	// https://sdk.vercel.ai/providers/ai-sdk-providers/deepseek
	protected provider(): any {
		return createDeepSeek({
			apiKey: this.apiKey(),
		});
	}

	protected apiKey(): string | undefined {
		return currentUser()?.llmConfig.deepseekKey || process.env.DEEPSEEK_API_KEY;
	}
}
