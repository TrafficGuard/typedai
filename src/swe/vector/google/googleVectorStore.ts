// File: src/swe/vector/google/google-vector-store.ts

import { DataStoreServiceClient, DocumentServiceClient, SearchServiceClient } from '@google-cloud/discoveryengine';
import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import pino from 'pino';
import { settleAllWithInput, sleep } from '#utils/async-utils';
import { SearchResult, VectorStore } from '../vector';
import { createDataStoreServiceClient, getDocumentServiceClient, getSearchServiceClient } from './config';
import { CodeFile, loadCodeFiles } from './indexing/codeLoader';
import { TextEmbeddingService, getEmbeddingService } from './indexing/embedder';
import { generateContextualizedChunksFromFile } from './indexing/unifiedChunkContextualizer';

const logger = pino({ name: 'GoogleVectorStore' });

export class GoogleVectorStore implements VectorStore {
	private readonly project: string;
	private readonly location: string;
	private readonly collection: string;
	private dataStoreId: string;
	private dataStoreClient: DataStoreServiceClient;
	private documentClient: DocumentServiceClient;
	private searchClient: SearchServiceClient;
	private dataStorePath: string | null = null;

	constructor(project: string, location: string, collection: string, dataStoreId: string) {
		this.project = project;
		this.location = location;
		this.collection = collection;
		this.dataStoreId = dataStoreId;

		this.documentClient = getDocumentServiceClient();
		this.searchClient = getSearchServiceClient();
		this.dataStoreClient = createDataStoreServiceClient(this.location);
	}

	async indexRepository(rootDir: string): Promise<void> {
		await this.ensureDataStoreExists();
		logger.info(`Starting indexing for data store: ${this.dataStoreId}`);
		await this.runIndexingPipelineInternal(rootDir);
	}

	private async runIndexingPipelineInternal(sourceDir: string): Promise<void> {
		// TODO: Implement indexing logic
	}

	async search(query: string, maxResults = 10): Promise<SearchResult[]> {
		await this.ensureDataStoreExists();
		logger.info({ query, maxResults }, `Performing search in data store: ${this.dataStoreId}`);
		return this.runSearchInternal(query, maxResults);
	}

	private async runSearchInternal(query: string, maxResults: number): Promise<SearchResult[]> {
		const servingConfigPath = this.searchClient.projectLocationCollectionDataStoreServingConfigPath(
			this.project,
			this.location,
			this.collection,
			this.dataStoreId,
			'default_config',
		);

		const queryEmbedding = await getEmbeddingService().generateEmbedding(query, 'CODE_RETRIEVAL_QUERY');
		if (!queryEmbedding) {
			logger.error({ query }, 'Failed to generate embedding for search query.');
			return [];
		}

		const searchRequest: google.cloud.discoveryengine.v1beta.ISearchRequest = {
			servingConfig: servingConfigPath,
			query: query,
			pageSize: maxResults,
			embeddingSpec: {
				embeddingVectors: [
					{
						fieldPath: 'embedding_vector',
						vector: queryEmbedding,
					},
				],
			},
		};

		const [response] = (await this.searchClient.search(searchRequest, {
			autoPaginate: false,
		})) as [google.cloud.discoveryengine.v1beta.ISearchResponse, any, any];

		const searchResultsWithScore = (response.results || [])
			.map((result) => {
				const fields = result.document?.structData?.fields;
				return {
					searchResult: {
						id: result.document?.id ?? 'unknown-id',
						document: {
							filePath: fields?.file_path?.stringValue ?? 'unknown_path',
							functionName: fields?.function_name?.stringValue,
							startLine: fields?.start_line?.numberValue ?? 0,
							endLine: fields?.end_line?.numberValue ?? 0,
							language: fields?.language?.stringValue ?? 'unknown',
							naturalLanguageDescription: fields?.natural_language_description?.stringValue ?? '',
							originalCode: fields?.original_code?.stringValue ?? '',
						},
					},
					score: result.document?.derivedStructData?.fields?.search_score?.numberValue ?? 0,
				};
			})
			.filter((item) => item.searchResult.id !== 'unknown-id');

		searchResultsWithScore.sort((a, b) => b.score - a.score);

		return searchResultsWithScore.map((item) => ({
			...item.searchResult,
			score: item.score,
		}));
	}

	private async ensureDataStoreExists(): Promise<void> {
		if (this.dataStorePath) return;

		const parent = `projects/${this.project}/locations/${this.location}/collections/${this.collection}`;
		const prospectivePath = `${parent}/dataStores/${this.dataStoreId}`;

		try {
			await this.dataStoreClient.getDataStore({ name: prospectivePath });
			logger.info(`Data store "${this.dataStoreId}" already exists.`);
		} catch (error: any) {
			if (error.code === 5) {
				// gRPC code for NOT_FOUND
				logger.warn(`Data store "${this.dataStoreId}" not found. Creating...`);
				const [operation] = await this.dataStoreClient.createDataStore({
					parent,
					dataStoreId: this.dataStoreId,
					dataStore: {
						displayName: `Repo: ${this.dataStoreId}`,
						industryVertical: 'GENERIC',
						solutionTypes: [google.cloud.discoveryengine.v1beta.SolutionType.SOLUTION_TYPE_SEARCH],
						contentConfig: 'NO_CONTENT',
					},
				});
				await operation.promise();
				logger.info(`Successfully created data store "${this.dataStoreId}".`);
			} else {
				logger.error({ error }, `Failed to get or create data store "${this.dataStoreId}".`);
				throw error;
			}
		}
		this.dataStorePath = prospectivePath;
	}
}

/**
 * Sanitizes a Git URL to be a valid Google Cloud resource ID.
 * Replaces non-alphanumeric characters with hyphens and enforces length constraints.
 * @param url The Git URL.
 * @returns A sanitized string suitable for a data store ID.
 */
export function sanitizeGitUrlForDataStoreId(url: string): string {
	return url
		.replace(/^https?:\/\//, '') // Remove protocol
		.replace(/\.git$/, '') // Remove .git suffix
		.replace(/[^a-zA-Z0-9-]/g, '_') // Replace non-alphanumeric with underscore
		.toLowerCase()
		.slice(0, 60); // Enforce max length for resource IDs
}
