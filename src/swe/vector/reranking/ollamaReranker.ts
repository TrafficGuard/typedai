import axios from 'axios';
import pino from 'pino';
import { IReranker, SearchResult } from '../core/interfaces';

const logger = pino({ name: 'OllamaReranker' });

export interface OllamaRerankerConfig {
	/** Ollama API URL (default: http://localhost:11434) */
	apiUrl?: string;
	/** Model for relevance scoring (default: 'qwen3:8b') */
	model?: string;
	/** Request timeout in ms (default: 60000) */
	timeout?: number;
	/** Batch size for parallel scoring (default: 5) */
	batchSize?: number;
}

/**
 * Ollama LLM-based reranker implementation
 * Uses pointwise relevance scoring - asks LLM to rate query-document relevance 0-10
 *
 * Note: Ollama does not natively support cross-encoder reranking models.
 * This implementation uses an LLM to score relevance, which is slower but works
 * with any Ollama model.
 */
export class OllamaReranker implements IReranker {
	private apiUrl: string;
	private model: string;
	private timeout: number;
	private batchSize: number;

	constructor(config?: OllamaRerankerConfig) {
		this.apiUrl = config?.apiUrl || process.env.OLLAMA_API_URL || 'http://localhost:11434';
		this.model = config?.model || 'qwen3:8b';
		this.timeout = config?.timeout || 60000;
		this.batchSize = config?.batchSize || 5;

		logger.info({ apiUrl: this.apiUrl, model: this.model }, 'OllamaReranker initialized');
	}

	/**
	 * Reranks search results using LLM-based relevance scoring
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

		// Limit results to rerank (more aggressive for LLM-based approach due to latency)
		const resultsToRerank = results.slice(0, Math.min(50, results.length));
		topK = Math.min(topK, resultsToRerank.length);

		logger.info({ query, inputCount: resultsToRerank.length, topK, model: this.model }, 'Starting Ollama LLM reranking');

		try {
			const startTime = Date.now();

			// Score results in batches
			const scoredResults = await this.scoreResultsBatch(query, resultsToRerank);

			// Sort by score descending and take top K
			const rerankedResults = scoredResults.sort((a, b) => b.score - a.score).slice(0, topK);

			const duration = Date.now() - startTime;
			logger.info({ inputCount: resultsToRerank.length, outputCount: rerankedResults.length, durationMs: duration }, 'Ollama reranking completed');

			return rerankedResults;
		} catch (error: any) {
			logger.error({ error: error.message, query }, 'Ollama reranking failed, returning original results');
			return results.slice(0, topK);
		}
	}

	/**
	 * Score results in parallel batches
	 */
	private async scoreResultsBatch(query: string, results: SearchResult[]): Promise<SearchResult[]> {
		const batches: SearchResult[][] = [];
		for (let i = 0; i < results.length; i += this.batchSize) {
			batches.push(results.slice(i, i + this.batchSize));
		}

		const scoredBatches = await Promise.all(batches.map((batch) => this.scoreBatch(query, batch)));

		return scoredBatches.flat();
	}

	/**
	 * Score a batch of results in parallel
	 */
	private async scoreBatch(query: string, results: SearchResult[]): Promise<SearchResult[]> {
		const scorePromises = results.map((result) => this.scoreResult(query, result));
		return Promise.all(scorePromises);
	}

	/**
	 * Score a single result using LLM
	 */
	private async scoreResult(query: string, result: SearchResult): Promise<SearchResult> {
		const documentContent = this.buildDocumentContent(result);

		const prompt = `You are a relevance scoring system. Rate how relevant the following code snippet is to the search query on a scale of 0 to 10, where 0 means completely irrelevant and 10 means perfectly relevant.

Query: ${query}

Code Snippet:
${documentContent.slice(0, 2000)}

Respond with ONLY a single number from 0 to 10. No explanation.`;

		try {
			const response = await axios.post(
				`${this.apiUrl}/api/generate`,
				{
					model: this.model,
					prompt,
					stream: false,
					options: {
						temperature: 0,
						num_predict: 5, // Only need a number
					},
				},
				{ timeout: this.timeout },
			);

			const scoreText = response.data.response?.trim() || '5';
			// Extract first number from response
			const match = scoreText.match(/\d+/);
			const rawScore = match ? Number.parseInt(match[0]) : 5;
			const score = Math.max(0, Math.min(10, rawScore)) / 10; // Normalize to 0-1

			return {
				...result,
				score,
				metadata: {
					...(result.metadata || {}),
					originalScore: result.score,
					rerankingScore: score,
				},
			};
		} catch (error: any) {
			logger.warn({ error: error.message, filePath: result.document.filePath }, 'Failed to score result, using original score');
			return result;
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
		parts.push(result.document.originalCode);
		parts.push(`File: ${result.document.filePath}`);
		if (result.document.functionName) {
			parts.push(`Function: ${result.document.functionName}`);
		}

		return parts.join('\n');
	}

	/**
	 * Check if Ollama is available and the model is loaded
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const response = await axios.get(`${this.apiUrl}/api/tags`, { timeout: 5000 });
			const models = response.data.models || [];
			return models.some((m: { name: string }) => m.name.startsWith(this.model.split(':')[0]));
		} catch {
			return false;
		}
	}
}
