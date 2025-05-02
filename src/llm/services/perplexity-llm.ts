import type { PerplexityProvider } from '@ai-sdk/perplexity';
import { createPerplexity } from '@ai-sdk/perplexity';
import type { GenerateTextResult, LanguageModelV1FinishReason, LanguageModelV1Usage } from 'ai';
import { Perplexity } from '#functions/web/perplexity';
import { currentUser, functionConfig } from '#user/userService/userContext';
import type { LlmCostFunction } from '../base-llm';
import { AiLLM } from './ai-llm';
import type { GenerateTextOptions, LLM, LlmMessage } from '../llm';

export const PERPLEXITY_SERVICE = 'perplexity';

/*
https://docs.perplexity.ai/guides/pricing
Model	Input Tokens (Per Million Tokens)	Output Tokens (Per Million Tokens)	Price per 1000 searches
sonar-reasoning-pro	$2	$8	$5
sonar-reasoning	$1	$5	$5
sonar-pro	$3	$15	$5
sonar	$1	$1	$5
*/

function perplexityCostFunction(inputMil: number, outputMil: number): LlmCostFunction {
	return (inputTokens: number, outputTokens: number, usage: LanguageModelV1Usage, completionTime?: Date, result?: GenerateTextResult<any, any>) => {
		// Extract Perplexity specific usage from providerMetadata
		const ppMetadata = result?.experimental_providerMetadata?.perplexity as { usage?: { numSearchQueries?: number; citationTokens?: number } } | undefined;
		const searches = ppMetadata?.usage?.numSearchQueries ?? 0;
		// const citationTokens = ppMetadata?.usage?.citationTokens ?? 0; // Not currently used in cost calculation

		const searchCost = searches * 0.005; // $5 per 1000 requests
		// thinking_tokens are not available via AI SDK metadata, omit thinkingCost for now.
		const inputCost = (inputTokens * inputMil) / 1_000_000;
		const outputCost = (outputTokens * outputMil) / 1_000_000;
		const totalCost = Number((inputCost + outputCost + searchCost).toFixed(6));

		return {
			inputCost, // Note: This doesn't include search/thinking cost separately
			outputCost, // Note: This doesn't include search/thinking cost separately
			totalCost,
		};
	};
}

export function perplexityLLMRegistry(): Record<string, () => LLM> {
	return {
		[`${PERPLEXITY_SERVICE}:sonar`]: perplexityLLM,
		[`${PERPLEXITY_SERVICE}:sonar-reasoning-pro`]: perplexityReasoningProLLM,
		[`${PERPLEXITY_SERVICE}:sonar-deep-research`]: perplexityDeepResearchLLM,
	};
}

export function perplexityLLM(): LLM {
	return new PerplexityLLM(
		'Perplexity',
		'sonar',
		127_000, // maxTokens
		perplexityCostFunction(1, 1), // $1/M input, $1/M output
	);
}

export function perplexityReasoningProLLM(): LLM {
	return new PerplexityLLM(
		'Perplexity Reasoning Pro',
		'sonar-reasoning-pro',
		127_000, // maxTokens
		perplexityCostFunction(2, 8), // $2/M input, $8/M output
	);
}

export function perplexityDeepResearchLLM(): LLM {
	return new PerplexityLLM(
		'Perplexity Deep Research',
		'sonar-deep-research',
		60_000, // maxTokens
		perplexityCostFunction(2, 8), // $2/M input, $8/M output
	);
}

export class PerplexityLLM extends AiLLM<PerplexityProvider> {
	constructor(displayName: string, model: string, maxTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, PERPLEXITY_SERVICE, model, maxTokens, calculateCosts);
	}

	protected apiKey(): string {
		// Ensure functionConfig is loaded if needed, or rely on env var
		return functionConfig(Perplexity)?.key || process.env.PERPLEXITY_API_KEY;
	}

	protected provider(): PerplexityProvider {
		this.aiProvider ??= createPerplexity({
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}

	protected async _generateTextFromMessages(
		llmMessages: LlmMessage[],
		opts?: GenerateTextOptions,
	): Promise<GenerateTextResult<LanguageModelV1FinishReason>> {
		// Let AiLLM handle the core generation
		const result = await super._generateTextFromMessages(llmMessages, opts);

		// Append sources/citations if available from Perplexity metadata
		const sources = result.experimental_providerMetadata?.perplexity?.sources as { url: string; title: string }[] | undefined;
		if (sources?.length) {
			const citationContent = `\n\nSources:\n${sources.map((source, index) => `[${index + 1}] ${source.title} (${source.url})`).join('\n')}`;
			result.text += citationContent;
		}

		// The cost calculation is handled within AiLLM using the updated perplexityCostFunction
		// which now correctly interprets the AI SDK usage and metadata.
		return result;
	}
}
