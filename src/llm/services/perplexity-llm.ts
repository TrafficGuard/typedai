import type { PerplexityProvider } from '@ai-sdk/perplexity';
import { createPerplexity } from '@ai-sdk/perplexity';
import type { GenerateTextResult } from 'ai';
import { Perplexity } from '#functions/web/perplexity';
import type { LLM, LlmCostFunction } from '#shared/llm/llm.model';
import { functionConfig } from '#user/userContext';
import { AiLLM } from './ai-llm';

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
	return (inputTokens: number, outputTokens: number, usage: any, completionTime?: Date, result?: GenerateTextResult<any, any>) => {
		// Extract Perplexity specific usage from providerMetadata
		const ppMetadata = result?.providerMetadata?.perplexity as { usage?: { numSearchQueries?: number; citationTokens?: number } } | undefined;
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
		127_000, // maxOutputTokens
		perplexityCostFunction(1, 1), // $1/M input, $1/M output
	);
}

export function perplexityReasoningProLLM(): LLM {
	return new PerplexityLLM(
		'Perplexity Reasoning Pro',
		'sonar-reasoning-pro',
		127_000, // maxOutputTokens
		perplexityCostFunction(2, 8), // $2/M input, $8/M output
	);
}

export function perplexityDeepResearchLLM(): LLM {
	return new PerplexityLLM(
		'Perplexity Deep Research',
		'sonar-deep-research',
		60_000, // maxOutputTokens
		perplexityCostFunction(2, 8), // $2/M input, $8/M output
	);
}

export class PerplexityLLM extends AiLLM<PerplexityProvider> {
	constructor(displayName: string, model: string, maxOutputTokens: number, calculateCosts: LlmCostFunction) {
		super(displayName, PERPLEXITY_SERVICE, model, maxOutputTokens, calculateCosts);
	}

	protected apiKey(): string {
		return functionConfig(Perplexity)?.key || process.env.PERPLEXITY_API_KEY;
	}

	protected provider(): PerplexityProvider {
		this.aiProvider ??= createPerplexity({
			apiKey: this.apiKey(),
		});
		return this.aiProvider;
	}
}

export function convertCitationsToMarkdownLinks(reportText: string, citations: string[]): string {
	// Create a regex pattern to match citation IDs in the report text
	const citationPattern = /\[(\d+)]/g;

	// Replace each citation ID with a markdown link
	return reportText.replace(citationPattern, (match, id) => {
		const citationId = Number.parseInt(id, 10) - 1; // Convert the matched ID to a number and subtract 1 (since array indices start at 0)
		if (citationId >= 0 && citationId < citations.length) {
			// If the citation ID is valid, replace the ID with a markdown link
			return `[${citations[citationId]}](#${citationId + 1})`;
		}
		// If the citation ID is not valid, return the original match to keep the text unchanged
		return match;
	});
}
