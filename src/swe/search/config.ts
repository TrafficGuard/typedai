import { DocumentServiceClient, SearchServiceClient } from '@google-cloud/discoveryengine';
import { envVar } from '#utils/env-var';

// Configuration constants (replace with your actual values or environment variable handling)
const GCLOUD_PROJECT = envVar('GCLOUD_PROJECT');
const DISCOVERY_ENGINE_LOCATION = process.env.DISCOVERY_ENGINE_LOCATION || 'global'; // e.g., 'global', 'us', 'eu'
const DISCOVERY_ENGINE_DATA_STORE_ID = envVar('DISCOVERY_ENGINE_DATA_STORE_ID'); // Your Data Store ID

// Instantiate clients
// Note: Authentication is handled implicitly by the Google Cloud SDK
// based on the environment (e.g., GOOGLE_APPLICATION_CREDENTIALS, gcloud auth).
let documentServiceClient: DocumentServiceClient | null = null;
let searchServiceClient: SearchServiceClient | null = null;

export function getDocumentServiceClient(): DocumentServiceClient {
	if (!documentServiceClient) {
		documentServiceClient = new DocumentServiceClient({
			apiEndpoint: `${DISCOVERY_ENGINE_LOCATION}-discoveryengine.googleapis.com`,
		});
	}
	return documentServiceClient;
}

export function getSearchServiceClient(): SearchServiceClient {
	if (!searchServiceClient) {
		searchServiceClient = new SearchServiceClient({
			apiEndpoint: `${DISCOVERY_ENGINE_LOCATION}-discoveryengine.googleapis.com`,
		});
	}
	return searchServiceClient;
}

export function getDiscoveryEngineDataStorePath(): string {
	return getDocumentServiceClient().projectLocationDataStorePath(GCLOUD_PROJECT, DISCOVERY_ENGINE_LOCATION, DISCOVERY_ENGINE_DATA_STORE_ID);
}

export function getDiscoveryEngineServingConfigPath(): string {
	// Default serving config is often 'default_config'
	const servingConfigId = 'default_config';
	return getSearchServiceClient().projectLocationDataStoreServingConfigPath(
		GCLOUD_PROJECT,
		DISCOVERY_ENGINE_LOCATION,
		DISCOVERY_ENGINE_DATA_STORE_ID,
		servingConfigId,
	);
}

// Export constants for use elsewhere if needed
export const DISCOVERY_ENGINE_EMBEDDING_MODEL = process.env.DISCOVERY_ENGINE_EMBEDDING_MODEL || 'text-embedding-005';
export const TRANSLATION_LLM_MODEL_ID = envVar('SEARCH_TRANSLATION_LLM_MODEL_ID', 'claude-3-haiku-20240307');
export const EMBEDDING_API_BATCH_SIZE = 25; // Max texts per single API call to Vertex AI by embedder.ts
export const INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE = 100; // Number of chunks indexer.ts will collect before calling generateEmbeddings
export { GCLOUD_PROJECT, DISCOVERY_ENGINE_LOCATION, DISCOVERY_ENGINE_DATA_STORE_ID };
