import { type DeepSeekProvider, createDeepSeek } from '@ai-sdk/deepseek';
import type { LlmCostFunction } from '#llm/base-llm';
import { currentUser } from '#user/userService/userContext';
import type { LLM } from '../llm';
import { AiLLM } from './ai-llm';

export const DEEPSEEK_SERVICE = 'deepseek';

export function deepseekLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${DEEPSEEK_SERVICE}:deepseek-chat`]: deepSeekV3,
		[`${DEEPSEEK_SERVICE}:deepseek-reasoner`]: deepSeekR1,
	};
}

// The DeepSeek API provides off-peak pricing discounts during 16:30-00:30 UTC each day.
// The completion timestamp of each request determines its pricing tier.
// https://api-docs.deepseek.com/quick_start/pricing
function deepseekCostFunction(
	cacheMissMTok: number,
	cacheHitMTok: number,
	offPeakCacheMissMTok: number,
	offPeakCacheHitMTok: number,
	outputMTok: number,
	offPeakOutputMTok: number,
): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage: any, completionTime: Date) => {
		const metadata = usage as { deepseek: { promptCacheMissTokens: number; promptCacheHitTokens: number } };
		const cacheMissTokens = metadata.deepseek.promptCacheMissTokens;
		const cacheHitTokens = metadata.deepseek.promptCacheHitTokens;

		const isOffPeak = isTimeBetween1630And0030(completionTime);

		const inputCost = isOffPeak
			? (cacheMissTokens * offPeakCacheMissMTok) / 1_000_000 + (cacheHitTokens * offPeakCacheHitMTok) / 1_000_000
			: (cacheMissTokens * cacheMissMTok) / 1_000_000 + (cacheHitTokens * cacheHitMTok) / 1_000_000;

		const outputCost = (outputTokens * (isOffPeak ? offPeakOutputMTok : outputMTok)) / 1_000_000;

		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}

export function isTimeBetween1630And0030(date: Date): boolean {
	const hours = date.getUTCHours();
	const minutes = date.getUTCMinutes();
	const timeInMinutes = hours * 60 + minutes;
	const startTime = 16 * 60 + 30; // 16:30 UTC
	const endTime = 24 * 60 + 30; // 00:30 UTC (next day)
	return timeInMinutes >= startTime || timeInMinutes < endTime - 24 * 60;
}

export function deepSeekV3(): LLM {
	return new DeepSeekLLM('DeepSeek v3', 'deepseek-chat', 64_000, deepseekCostFunction(0.27, 0.07, 0.135, 0.035, 1.1, 0.55));
}

export function deepSeekR1(): LLM {
	return new DeepSeekLLM('DeepSeek R1', 'deepseek-reasoner', 64_000, deepseekCostFunction(0.55, 0.14, 0.135, 0.035, 2.19, 0.55));
}

/**
 * Deepseek models
 * @see https://platform.deepseek.com/api-docs/api/create-chat-completion
 */
export class DeepSeekLLM extends AiLLM<DeepSeekProvider> {
	constructor(displayName: string, model: string, maxTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, DEEPSEEK_SERVICE, model, maxTokens, calculateCosts);
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
