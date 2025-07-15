import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import { struct } from 'pb-util';
import pino from 'pino';
import { DISCOVERY_ENGINE_LOCATION, GCLOUD_PROJECT, getSearchServiceClient } from './config';
import { generateEmbedding } from './indexing/embedder';

const logger = pino({ name: 'Search' });

export interface SearchResultItem {
	id: string;
	score: number;
	document: {
		filePath: string;
		functionName?: string;
		startLine: number;
		endLine: number;
		language: string;
		naturalLanguageDescription: string;
		originalCode: string;
	};
}

/**
 * Performs a vector search in Discovery Engine based on a natural language query.
 * @param dataStoreId The ID of the Discovery Engine Data Store to search in.
 * @param query The natural language query string.
 * @param numResults The maximum number of results to return.
 * @param lexicalFieldBoosts Optional: Allows specifying boosts for fields in lexical search.
 * @param hybridAlpha Optional: Controls the weighting between semantic (1.0) and lexical (0.0) search. Must be between 0 and 1.
 * @returns A promise that resolves to an array of search result items.
 */
export async function searchCode(
	dataStoreId: string,
	query: string,
	numResults = 10,
	lexicalFieldBoosts: Record<string, number> = { lexical_search_text: 0.7 },
	hybridAlpha = 0.5,
): Promise<SearchResultItem[]> {
	logger.info({ query, numResults, lexicalFieldBoosts, hybridAlpha }, `Performing search for query: "${query}"`);

	if (!query) {
		logger.warn('Search query is empty.');
		return [];
	}

	const client = getSearchServiceClient();
	// Construct the serving config path directly using imported constants
	const servingConfigId = 'default_config'; // Default serving config ID
	const servingConfigPath = client.projectLocationDataStoreServingConfigPath(GCLOUD_PROJECT, DISCOVERY_ENGINE_LOCATION, dataStoreId, servingConfigId);

	// 1. Generate embedding for the query
	const queryEmbedding = await generateEmbedding(query, 'RETRIEVAL_DOCUMENT');
	if (!queryEmbedding || queryEmbedding.length === 0) {
		logger.error({ query }, 'Failed to generate embedding for the search query after all retries. Cannot perform search.');
		return [];
	}

	// 2. Construct the Search Request
	const searchRequest: google.cloud.discoveryengine.v1beta.ISearchRequest = {
		servingConfig: servingConfigPath,
		// query: query, // Include original query text for potential hybrid search/logging
		pageSize: numResults,
		embeddingSpec: {
			embeddingVectors: [
				{
					fieldPath: 'embedding_vector', // *** MUST MATCH the field path used during indexing ***
					vector: queryEmbedding,
				},
			],
		},
	};

	// Add hybrid search parameters
	const requestParamsInternal: { [key: string]: any } = {};

	// if (hybridAlpha !== undefined && hybridAlpha >= 0 && hybridAlpha <= 1) {
	// 	// The actual key name 'alpha' or 'hybrid_alpha' or similar needs to be confirmed
	// 	// from Discovery Engine documentation for use with the 'params' field.
	// 	// Based on Perplexity research, 'alpha' is a common term.
	// 	requestParamsInternal.alpha = hybridAlpha;
	// }

	// if (lexicalFieldBoosts && Object.keys(lexicalFieldBoosts).length > 0) {
	// 	// The actual key name 'field_boosts' or 'fieldBoosts' or similar needs to be confirmed
	// 	// from Discovery Engine documentation for use with the 'params' field.
	// 	// Based on Perplexity research, 'field_boosts' is a common term.
	// 	requestParamsInternal.field_boosts = lexicalFieldBoosts;
	// }

	if (Object.keys(requestParamsInternal).length > 0) {
		const encodedParams = struct.encode(requestParamsInternal);
		if (encodedParams.fields) {
			searchRequest.params = encodedParams.fields;
		}
	}

	try {
		// 3. Call the Search API
		// The response is a tuple containing: [results, request, response]
		const [searchApiResponse] = await client.search(searchRequest);
		logger.info({ query }, `Received ${searchApiResponse?.length ?? 0} search results.`);

		// 4. Process Results
		const results: SearchResultItem[] = [];
		if (searchApiResponse) {
			for (const result of searchApiResponse) {
				// Ensure result and document exist before proceeding
				if (result.document?.structData?.fields) {
					const fields = result.document.structData.fields;
					// Helper to safely extract string values from Struct fields
					const getString = (fieldName: string): string | undefined => fields[fieldName]?.stringValue;
					// Helper to safely extract number values
					const getNumber = (fieldName: string): number | undefined => fields[fieldName]?.numberValue;

					const item: SearchResultItem = {
						id: result.document.id ?? 'unknown-id',
						score: result.document.derivedStructData?.fields?.search_score?.numberValue ?? 0, // Check actual score field name
						document: {
							filePath: getString('file_path') ?? 'unknown_path',
							functionName: getString('function_name'), // Optional
							startLine: getNumber('start_line') ?? 0,
							endLine: getNumber('end_line') ?? 0,
							language: getString('language') ?? 'unknown',
							naturalLanguageDescription: getString('natural_language_description') ?? '',
							originalCode: getString('original_code') ?? '',
						},
					};
					results.push(item);
				}
			}
		}

		// Sort by score if needed (API might already do this)
		results.sort((a, b) => b.score - a.score);

		logger.info({ query, resultsCount: results.length }, `Search successful. Found ${results.length} results.`);
		return results;
	} catch (apiError: any) {
		logger.error(
			{
				err: { message: apiError.message, stack: apiError.stack, details: apiError.details },
				query,
			},
			'API call failed for search.',
		);
		throw apiError;
	}
}
