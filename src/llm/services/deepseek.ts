import { DeepSeekProvider, createDeepSeek } from '@ai-sdk/deepseek';
import { InputCostFunction, OutputCostFunction, perMilTokens } from '#llm/base-llm';
import { currentUser } from '#user/userService/userContext';
import { LLM } from '../llm';
import { AiLLM } from './ai-llm';

export const DEEPSEEK_SERVICE = 'deepseek';

export function deepseekLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${DEEPSEEK_SERVICE}:deepseek-chat`]: deepSeekV3,
		[`${DEEPSEEK_SERVICE}:deepseek-reasoner`]: deepSeekR1,
	};
}

export function deepSeekV3(): LLM {
	return new DeepSeekLLM('DeepSeek v3', 'deepseek-chat', 64000, inputCostFunction(0.27, 0.07), perMilTokens(1.1));
}

export function deepSeekR1(): LLM {
	return new DeepSeekLLM('DeepSeek R1', 'deepseek-reasoner', 64000, inputCostFunction(0.55, 0.14), perMilTokens(2.19));
}

function inputCostFunction(cacheMissMTok: number, cacheHitMTok: number): InputCostFunction {
	// TODO DeepSeek API provides off-peak pricing discounts during 16:30-00:30 UTC each day. The completion timestamp of each request determines its pricing tier.
	return (input: string, tokens: number, usage: any) => {
		return (usage.deepseek.promptCacheMissTokens * cacheMissMTok) / 1_000_000 + (usage.deepseek.promptCacheHitTokens * cacheHitMTok) / 1_000_000;
	};
}

/**
 * Deepseek models
 * @see https://platform.deepseek.com/api-docs/api/create-chat-completion
 */
export class DeepSeekLLM extends AiLLM<DeepSeekProvider> {
	constructor(displayName: string, model: string, maxTokens: number, inputCostPerToken: InputCostFunction, outputCostPerToken: OutputCostFunction) {
		super(displayName, DEEPSEEK_SERVICE, model, maxTokens, inputCostPerToken, outputCostPerToken);
	}

	// https://sdk.vercel.ai/providers/ai-sdk-providers/deepseek
	protected provider(): any {
		return createDeepSeek({
			apiKey: this.apiKey(),
		});
	}

	protected apiKey(): string | undefined {
		return currentUser().llmConfig.deepseekKey || process.env.DEEPSEEK_API_KEY;
	}
}
