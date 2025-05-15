// Changed 'import type' to 'import' because enum values are used
import { google } from '@google-cloud/discoveryengine/build/protos/protos';
import pino from 'pino';
import { sleep } from '#utils/async-utils';
import { DISCOVERY_ENGINE_DATA_STORE_ID, DISCOVERY_ENGINE_LOCATION, GCLOUD_PROJECT, getSearchServiceClient } from './config'; // Corrected relative path
import { generateEmbedding } from './indexing/embedder'; // Use the same embedder

const logger = pino({ name: 'Search' });

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const RETRY_DELAY_MULTIPLIER = 2;

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
 * @param query The natural language query string.
 * @param numResults The maximum number of results to return.
 * @returns A promise that resolves to an array of search result items.
 */
export async function searchCode(query: string, numResults = 10): Promise<SearchResultItem[]> {
	const functionName = 'searchCode';
	logger.info({ functionName, query, numResults }, `Performing search for query: "${query}"`);

	if (!query) {
		logger.warn('Search query is empty.');
		return [];
	}

	const client = getSearchServiceClient();
	// Construct the serving config path directly using imported constants
	const servingConfigId = 'default_config'; // Default serving config ID
	const servingConfigPath = client.projectLocationDataStoreServingConfigPath(
		GCLOUD_PROJECT,
		DISCOVERY_ENGINE_LOCATION,
		DISCOVERY_ENGINE_DATA_STORE_ID,
		servingConfigId,
	);

	// 1. Generate embedding for the query
	const queryEmbedding = await generateEmbedding(query, 'CODE_RETRIEVAL_QUERY');
	if (!queryEmbedding || queryEmbedding.length === 0) {
		logger.error({ functionName, query }, 'Failed to generate embedding for the search query after all retries. Cannot perform search.');
		return [];
	}

	// 2. Construct the Search Request
	const searchRequest: google.cloud.discoveryengine.v1beta.ISearchRequest = {
		servingConfig: servingConfigPath,
		query: query, // Include original query text for potential hybrid search/logging
		pageSize: numResults,
		queryExpansionSpec: {
			condition: google.cloud.discoveryengine.v1beta.SearchRequest.QueryExpansionSpec.Condition.AUTO,
		},
		spellCorrectionSpec: {
			mode: google.cloud.discoveryengine.v1beta.SearchRequest.SpellCorrectionSpec.Mode.AUTO,
		},
		contentSearchSpec: {
			snippetSpec: {
				returnSnippet: true, // Optionally return snippets
			},
			summarySpec: {
				// Optionally request summaries
				summaryResultCount: 3, // Number of results to summarize
				// includeCitations: true, // If using grounding/citations
			},
			extractiveContentSpec: {
				maxExtractiveAnswerCount: 1, // If using extractive answers
			},
			// Vector search specific configuration
			searchResultMode: google.cloud.discoveryengine.v1beta.SearchRequest.ContentSearchSpec.SearchResultMode.DOCUMENTS, // Or CHUNKS if using chunk-level indexing
			chunkSpec: {
				// If searching chunks within documents
				// numPreviousChunks: 1,
				// numPreviousChunks: 1,
				// numNextChunks: 1,
			},
		},
		// Moved embeddingSpec to the top level of the request object
		embeddingSpec: {
			embeddingVectors: [
				{
					fieldPath: 'embedding_vector', // *** MUST MATCH the field path used during indexing ***
					vector: queryEmbedding,
				},
			],
		},
		// Optional: Filter based on metadata fields (e.g., language)
		// filter: 'language = "python"',
	};

	for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
		try {
			logger.info({ functionName, query, attempt: attempt + 1, maxRetries: MAX_RETRIES }, `Attempting search (attempt ${attempt + 1}/${MAX_RETRIES})...`);
			logger.debug({ functionName, query, attempt: attempt + 1, searchRequest: JSON.stringify(searchRequest, null, 2) }, 'Sending search request');

			// 3. Call the Search API
			// The response is a tuple containing: [results, request, response]
			const [searchApiResponse] = await client.search(searchRequest);

			logger.info({ functionName, query, attempt: attempt + 1 }, `Received ${searchApiResponse?.length ?? 0} search results.`);
			// logger.debug(`Search response: ${JSON.stringify(searchApiResponse, null, 2)}`);

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

			logger.info(
				{ functionName, query, resultsCount: results.length, attempt: attempt + 1 },
				`Search successful on attempt ${attempt + 1}. Found ${results.length} results.`,
			);
			return results; // Success, exit function
		} catch (apiError: any) {
			const delay = INITIAL_RETRY_DELAY_MS * RETRY_DELAY_MULTIPLIER ** attempt;
			logger.error(
				{
					functionName,
					err: { message: apiError.message, stack: apiError.stack, details: apiError.details },
					attempt: attempt + 1,
					maxRetries: MAX_RETRIES,
					delay,
					query,
				},
				`API call failed for search (Attempt ${attempt + 1}/${MAX_RETRIES}). Retrying in ${delay}ms...`,
			);

			if (attempt < MAX_RETRIES - 1) {
				await sleep(delay);
			} else {
				logger.error(
					{ functionName, err: { message: apiError.message, stack: apiError.stack }, query },
					`All ${MAX_RETRIES} retries failed for search. Returning empty results.`,
				);
				return []; // All retries failed
			}
		}
	}
	// Fallback, should ideally be unreachable if all paths in loop return.
	logger.warn({ functionName, query }, 'Search function reached end without returning, implies an issue in retry logic. Returning empty array.');
	return [];
}

// Example usage (called from index.ts)
// searchCode('function to load user data from database')
//   .then(results => console.log('Search results:', results))
//   .catch(err => console.error('Search failed:', err));
