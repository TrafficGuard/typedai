import axios from 'axios';
import pino from 'pino';
import { getSecretEnvVar } from '#config/secretConfig';
import { IReranker, SearchResult } from '../core/interfaces';

const logger = pino({ name: 'MorphLLMReranker' });

export interface MorphLLMRerankerConfig {
	/** MorphLLM API URL (default: https://api.morphllm.com/v1) */
	apiUrl?: string;
	/** API key (if not provided, uses getSecretEnvVar('MORPHLLM_API_KEY')) */
	apiKey?: string;
	/** Reranking model (default: 'mxbai-rerank-base-v1') */
	model?: string;
	/** Request timeout in ms (default: 30000) */
	timeout?: number;
}

/**
 * MorphLLM rerank response format
 */
interface MorphLLMRerankResult {
	index: number;
	relevance_score: number;
}

interface MorphLLMRerankResponse {
	results: MorphLLMRerankResult[];
}

/**
 * MorphLLM reranker implementation
 * Uses MorphLLM's rerank API endpoint
 * @see https://docs.morphllm.com/api-reference/endpoint/rerank
 */
export class MorphLLMReranker implements IReranker {
	private apiUrl: string;
	private apiKey: string;
	private model: string;
	private timeout: number;

	constructor(config?: MorphLLMRerankerConfig) {
		this.apiUrl = config?.apiUrl || process.env.MORPHLLM_API_URL || 'https://api.morphllm.com/v1';
		this.apiKey = config?.apiKey || getSecretEnvVar('MORPHLLM_API_KEY', '');
		this.model = config?.model || 'mxbai-rerank-base-v1';
		this.timeout = config?.timeout || 30000;

		if (!this.apiKey) {
			logger.warn('MORPHLLM_API_KEY not set - MorphLLM reranking will fail');
		}

		logger.info({ apiUrl: this.apiUrl, model: this.model }, 'MorphLLMReranker initialized');
	}

	/**
	 * Reranks search results using MorphLLM's rerank API
	 * @param query The search query
	 * @param results The initial search results to rerank
	 * @param topK Number of top results to return
	 * @returns Reranked results with updated scores
	 */
	async rerank(query: string, results: SearchResult[], topK = 10): Promise<SearchResult[]> {
		if (results.length === 0) {
			logger.debug('No results to rerank');
			return results;
		}

		if (!this.apiKey) {
			logger.warn('MORPHLLM_API_KEY not set, returning original results');
			return results.slice(0, topK);
		}

		// MorphLLM may have limits; use 200 as a reasonable max
		const resultsToRerank = results.slice(0, Math.min(200, results.length));
		topK = Math.min(topK, resultsToRerank.length);

		logger.info({ query, inputCount: resultsToRerank.length, topK }, 'Starting MorphLLM reranking');

		// Convert SearchResults to document strings for MorphLLM API
		const documents = resultsToRerank.map((result) => this.buildDocumentContent(result));

		try {
			const startTime = Date.now();

			const response = await axios.post<MorphLLMRerankResponse>(
				`${this.apiUrl}/rerank`,
				{
					model: this.model,
					query,
					documents,
					top_k: topK,
				},
				{
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						'Content-Type': 'application/json',
					},
					timeout: this.timeout,
				},
			);

			const duration = Date.now() - startTime;

			if (!response.data.results || response.data.results.length === 0) {
				logger.warn('Reranking returned no results, returning original');
				return results.slice(0, topK);
			}

			// Map reranked results back to SearchResults
			const rerankedResults: SearchResult[] = response.data.results.map((ranked) => {
				const originalResult = resultsToRerank[ranked.index];
				return {
					...originalResult,
					score: ranked.relevance_score,
					metadata: {
						...(originalResult.metadata || {}),
						originalScore: originalResult.score,
						rerankingScore: ranked.relevance_score,
					},
				};
			});

			logger.info({ inputCount: resultsToRerank.length, outputCount: rerankedResults.length, durationMs: duration }, 'MorphLLM reranking completed');

			return rerankedResults;
		} catch (error: any) {
			logger.error({ error: error.message, query }, 'MorphLLM reranking failed, returning original results');
			return results.slice(0, topK);
		}
	}

	/**
	 * Builds document content string for reranking
	 */
	private buildDocumentContent(result: SearchResult): string {
		const parts: string[] = [];

		if (result.document.naturalLanguageDescription) {
			parts.push(result.document.naturalLanguageDescription);
		}
		if (result.document.context) {
			parts.push(result.document.context);
		}
		parts.push(result.document.originalCode);
		parts.push(`File: ${result.document.filePath}`);
		if (result.document.functionName) {
			parts.push(`Function: ${result.document.functionName}`);
		}
		if (result.document.className) {
			parts.push(`Class: ${result.document.className}`);
		}

		return parts.join('\n\n');
	}
}
