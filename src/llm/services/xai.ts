import { XaiProvider, createXai } from '@ai-sdk/xai';
import { fixedCostPerMilTokens } from '#llm/base-llm';
import { AiLLM } from '#llm/services/ai-llm';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';

export const XAI_SERVICE = 'xai';

export class XAI extends AiLLM<XaiProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, XAI_SERVICE, model, maxOutputTokens, calculateCosts);
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
	};
}

export function xai_Grok4(): LLM {
	return new XAI('Grok 4', 'grok-4', 131_072, grok4CostFunction(3, 15, 6, 30, 0.75));
}

export function grok4CostFunction(
	inputMilLow: number,
	outputMilLow: number,
	inputMilHigh: number,
	outputMilHigh: number,
	cachedInput: number,
	threshold = 128000,
): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage, completionTime, result) => {
		let inputMil = inputMilLow;
		let outputMil = outputMilLow;
		if (inputTokens >= threshold) {
			inputMil = inputMilHigh;
			outputMil = outputMilHigh;
		}
		console.log(usage);

		const inputCost = (inputTokens * inputMil) / 1_000_000;
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		return {
			inputCost,
			outputCost,
			totalCost: inputCost + outputCost,
		};
	};
}
