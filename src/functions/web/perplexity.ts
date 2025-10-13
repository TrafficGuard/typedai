import PerplexitySDK from '@perplexity-ai/perplexity_ai';
import { agentContext, llms } from '#agent/agentContextLocalStorage';
import { func, funcClass } from '#functionSchema/functionDecorators';
import { perplexityReasoningProLLM } from '#llm/services/perplexity-llm';
import { logger } from '#o11y/logger';
import { cacheRetry } from '../../cache/cacheRetry';

const log = logger.child({ class: 'Perplexity' });

export interface PerplexityConfig {
	key: string;
}

export interface PerplexitySearchOptions {
	query: string | string[];
	max_results?: number;
	country?: string;
	return_images?: boolean;
	return_snippets?: boolean;
}

export interface PerplexitySearchResult {
	title: string;
	url: string;
	date?: string;
	snippet?: string;
	images?: string[];
}

export interface PerplexitySearchResponse {
	results: PerplexitySearchResult[];
}

@funcClass(__filename)
export class Perplexity {
	private sdkClient: PerplexitySDK;

	constructor() {
		// SDK automatically uses PERPLEXITY_API_KEY from environment
		this.sdkClient = new PerplexitySDK();
	}

	/**
	 * Calls Perplexity.ai agent to perform online research.
	 * @param researchTask the comprehensive, detailed task to for the AI agent with online research capabilities to answer.
	 * @param saveToMemory if the response should be saved to the agent memory.
	 * @returns {string} if saveToMemory is true then returns the memory key. If saveToMemory is false then returns the research contents.
	 */
	@cacheRetry()
	@func()
	async research(researchTask: string, saveToMemory: boolean): Promise<string> {
		try {
			const report: string = await perplexityReasoningProLLM().generateText(researchTask, { id: 'Perplexity' });

			if (saveToMemory) {
				const summary = await llms().easy.generateText(
					`<query>${researchTask}</query>\nGenerate a summarised version of the research key in one short sentence at most, with only alphanumeric with underscores for spaces. Answer concisely with only the summary.`,
					{ id: 'Perplexity memory key' },
				);
				const key = `Perplexity-${summary}`;
				agentContext()!.memory[key] = report;
				return key;
			}
			return report;
		} catch (e) {
			log.error(e, `Perplexity error. Query: ${researchTask}`);
			throw e;
		}
	}

	/**
	 * Performs a web search using Perplexity's search API.
	 * @param query - The search query.
	 * @returns {PerplexitySearchResponse} The search results with titles, URLs, snippets.
	 */
	@cacheRetry()
	@func()
	async webSearch(query: string | string[]): Promise<PerplexitySearchResponse> {
		const searchParams: PerplexitySearchOptions = { query, max_results: 15, return_snippets: true };
		try {
			const response = await this.sdkClient.search.create(searchParams);

			// Transform SDK response to our interface
			return {
				results: response.results.map((r: any) => ({
					title: r.title,
					url: r.url,
					date: r.date,
					snippet: r.snippet,
					// images: r.images,
				})),
			};
		} catch (e) {
			log.error(e, `Perplexity web search error. query: ${JSON.stringify(query)}`);
			throw e;
		}
	}
}
