// https://cloud.google.com/nodejs/docs/reference/discoveryengine/latest/discoveryengine/v1.rankserviceclient
import { RankServiceClient } from '@google-cloud/discoveryengine';
import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import pino from 'pino';
import { IReranker, SearchResult } from '../core/interfaces';
import { GoogleVectorServiceConfig } from './googleVectorConfig';

const logger = pino({ name: 'GoogleReranker' });

/**
 * Google Vertex AI Ranking service for reranking search results
 * Uses semantic-ranker-512@latest model to reorder results based on semantic relevance
 * https://cloud.google.com/generative-ai-app-builder/docs/ranking
 */
export class GoogleReranker implements IReranker {
	private rankClient: RankServiceClient;
	private project: string;
	private location: string;
	private model: string;

	constructor(
		config: GoogleVectorServiceConfig,
		options?: {
			model?: string;
		},
	) {
		this.project = config.project;
		this.location = config.discoveryEngineLocation;
		this.model = options?.model || 'semantic-ranker-512@latest';

		this.rankClient = new RankServiceClient({
			apiEndpoint: `${config.discoveryEngineLocation}-discoveryengine.googleapis.com`,
		});

		logger.info({ project: this.project, location: this.location, model: this.model }, 'GoogleReranker initialized');
	}

	/**
	 * Reranks search results using Google Vertex AI Ranking API
	 * @param query The search query
	 * @param results The initial search results to rerank
	 * @param topK Number of top results to return (max 200)
	 * @returns Reranked results with updated scores
	 */
	async rerank(query: string, results: SearchResult[], topK = 10): Promise<SearchResult[]> {
		if (results.length === 0) {
			logger.debug('No results to rerank');
			return results;
		}

		// Limit to 200 records (API constraint)
		const resultsToRerank = results.slice(0, Math.min(200, results.length));
		topK = Math.min(topK, resultsToRerank.length);

		logger.info({ query, inputCount: resultsToRerank.length, topK }, 'Starting reranking');

		// Convert SearchResults to Google Ranking API records
		const records: google.cloud.discoveryengine.v1.IRankingRecord[] = resultsToRerank.map((result, index) => ({
			id: String(index), // Use index as ID to map back to results
			title: result.document.functionName || result.document.className || result.document.filePath,
			content: this.buildRecordContent(result),
		}));

		// Build ranking config path
		const rankingConfig = `projects/${this.project}/locations/${this.location}/rankingConfigs/default_ranking_config`;

		try {
			const startTime = Date.now();

			// Call Google Ranking API
			const [response] = await this.rankClient.rank({
				rankingConfig,
				model: this.model,
				query,
				records,
				topN: topK,
				ignoreRecordDetailsInResponse: false,
			});

			const duration = Date.now() - startTime;

			if (!response.records || response.records.length === 0) {
				logger.warn('Reranking returned no records, returning original results');
				return results.slice(0, topK);
			}

			// Map reranked records back to SearchResults
			const rerankedResults: SearchResult[] = response.records.map((record) => {
				const originalIndex = Number.parseInt(record.id || '0');
				const originalResult = resultsToRerank[originalIndex];

				const result: SearchResult = {
					...originalResult,
					// Keep original score for reference, use reranking score as primary
					score: record.score ?? originalResult.score,
					metadata: {
						...(originalResult.metadata || {}),
						originalScore: originalResult.score,
						rerankingScore: record.score ?? undefined,
					},
				};

				return result;
			});

			logger.info(
				{
					inputCount: resultsToRerank.length,
					outputCount: rerankedResults.length,
					topK,
					durationMs: duration,
				},
				'Reranking completed',
			);

			return rerankedResults;
		} catch (error: any) {
			logger.error({ error, query }, 'Reranking failed, returning original results');
			// Fallback to original results on error
			return results.slice(0, topK);
		}
	}

	/**
	 * Builds content string for ranking record from search result
	 * Combines code, description, and metadata for best semantic matching
	 */
	private buildRecordContent(result: SearchResult): string {
		const parts: string[] = [];

		// Add natural language description if available
		if (result.document.naturalLanguageDescription) {
			parts.push(result.document.naturalLanguageDescription);
		}

		// Add context if available (from contextual chunking)
		if (result.document.context) {
			parts.push(result.document.context);
		}

		// Add original code
		parts.push(result.document.originalCode);

		// Add file path for context
		parts.push(`File: ${result.document.filePath}`);

		// Add function/class name if available
		if (result.document.functionName) {
			parts.push(`Function: ${result.document.functionName}`);
		}
		if (result.document.className) {
			parts.push(`Class: ${result.document.className}`);
		}

		return parts.join('\n\n');
	}
}
