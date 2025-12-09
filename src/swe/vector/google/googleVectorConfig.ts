import { envVar } from '#utils/env-var';

// Export constants for use elsewhere if needed
export const GCLOUD_PROJECT = envVar('GCLOUD_PROJECT');
export const DISCOVERY_ENGINE_LOCATION = envVar('DISCOVERY_ENGINE_LOCATION', 'global');
export const DISCOVERY_ENGINE_COLLECTION_ID = envVar('DISCOVERY_ENGINE_COLLECTION_ID', 'default_collection');
export const GCLOUD_REGION = envVar('GCLOUD_REGION', 'us-central1');
export const DISCOVERY_ENGINE_DATA_STORE_ID = envVar('DISCOVERY_ENGINE_DATA_STORE_ID', 'test-datastore');
export const DISCOVERY_ENGINE_EMBEDDING_MODEL = process.env.DISCOVERY_ENGINE_EMBEDDING_MODEL || 'gemini-embedding-001';
export const EMBEDDING_API_BATCH_SIZE = 25;
export const INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE = 100;

// Discovery Engine API rate limiting
export const DISCOVERY_ENGINE_REQUESTS_PER_MINUTE = 60;
export const FILE_PROCESSING_PARALLEL_BATCH_SIZE = 15;

// Circuit breaker configuration
export const CIRCUIT_BREAKER_RETRY_INTERVAL_MS = 5000; // 5 seconds
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 1; // Open circuit after 1 quota error
export const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 1; // Close circuit after 1 successful test

export interface GoogleVectorServiceConfig {
	project: string;
	/** Embedding service region */
	region: string;
	discoveryEngineLocation: string;
	collection: string;
	dataStoreId: string;
	embeddingModel: string;
}

export function getGoogleVectorServiceConfig(): GoogleVectorServiceConfig {
	return {
		project: GCLOUD_PROJECT,
		region: GCLOUD_REGION,
		discoveryEngineLocation: DISCOVERY_ENGINE_LOCATION,
		collection: DISCOVERY_ENGINE_COLLECTION_ID,
		dataStoreId: DISCOVERY_ENGINE_DATA_STORE_ID,
		embeddingModel: DISCOVERY_ENGINE_EMBEDDING_MODEL,
	};
}
