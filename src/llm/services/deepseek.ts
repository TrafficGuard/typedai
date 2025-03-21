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
	return new DeepSeekLLM('DeepSeek v3', 'deepseek-chat', 64_000, inputCostFunction(0.27, 0.07, 0.135, 0.035), outputCostFunction(1.1, 0.55));
}

export function deepSeekR1(): LLM {
	return new DeepSeekLLM('DeepSeek R1', 'deepseek-reasoner', 64_000, inputCostFunction(0.55, 0.14, 0.135, 0.035), outputCostFunction(2.19, 0.55));
}

// The DeepSeek API provides off-peak pricing discounts during 16:30-00:30 UTC each day. The completion timestamp of each request determines its pricing tier.
// https://api-docs.deepseek.com/quick_start/pricing

function inputCostFunction(cacheMissMTok: number, cacheHitMTok: number, offPeakCacheMissMTok: number, offPeakCacheHitMTok: number): InputCostFunction {
	return (input: string, tokens: number, usage: any, completionTime: Date) => {
		const cacheMissTokens = usage.deepseek.promptCacheMissTokens;
		const cacheHitTokens = usage.deepseek.promptCacheHitTokens;
		return isTimeBetween1630And0030(completionTime)
			? (cacheMissTokens * offPeakCacheMissMTok) / 1_000_000 + (cacheHitTokens * offPeakCacheHitMTok) / 1_000_000
			: (cacheMissTokens * cacheMissMTok) / 1_000_000 + (cacheHitTokens * cacheHitMTok) / 1_000_000;
	};
}

function outputCostFunction(outputMTok: number, offPeakOutputMTok: number): InputCostFunction {
	return (input: string, tokens: number, usage: any, completionTime: Date) => {
		return (tokens * (isTimeBetween1630And0030(completionTime) ? offPeakOutputMTok : outputMTok)) / 1_000_000;
	};
}

export function isTimeBetween1630And0030(date: Date): boolean {
	const hours = date.getUTCHours();
	const minutes = date.getUTCMinutes();

	// Convert the time to minutes since midnight
	const timeInMinutes = hours * 60 + minutes;

	// Define the range
	const startTime = 16 * 60 + 30; // 16:30 UTC
	const endTime = 24 * 60 + 30; // 00:30 UTC (next day)

	// Check if the time is within the range
	return timeInMinutes >= startTime || timeInMinutes < endTime - 24 * 60;
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
