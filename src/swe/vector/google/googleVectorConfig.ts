import { envVar } from '#utils/env-var';

// Constants that don't require GCLOUD_PROJECT
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

/**
 * Gets the Google Vector Service configuration from environment variables.
 */
export function getGoogleVectorServiceConfig(): GoogleVectorServiceConfig {
	return {
		project: envVar('GCLOUD_PROJECT'),
		region: envVar('GCLOUD_REGION', 'us-central1'),
		discoveryEngineLocation: envVar('DISCOVERY_ENGINE_LOCATION', 'global'),
		collection: envVar('DISCOVERY_ENGINE_COLLECTION_ID', 'default_collection'),
		dataStoreId: envVar('DISCOVERY_ENGINE_DATA_STORE_ID', 'test-datastore'),
		embeddingModel: process.env.DISCOVERY_ENGINE_EMBEDDING_MODEL || 'gemini-embedding-001',
	};
}
