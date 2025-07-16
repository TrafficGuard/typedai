import { DataStoreServiceClient, DocumentServiceClient, SearchServiceClient } from '@google-cloud/discoveryengine';
import { envVar } from '#utils/env-var';

// Export constants for use elsewhere if needed
export const GCLOUD_PROJECT = envVar('GCLOUD_PROJECT');
export const DISCOVERY_ENGINE_LOCATION = envVar('DISCOVERY_ENGINE_LOCATION', 'global');
export const DISCOVERY_ENGINE_COLLECTION_ID = envVar('DISCOVERY_ENGINE_COLLECTION_ID', 'default_collection');
export const GCLOUD_REGION = envVar('GCLOUD_REGION', 'us-central1');
export const DISCOVERY_ENGINE_DATA_STORE_ID = envVar('DISCOVERY_ENGINE_DATA_STORE_ID');
export const DISCOVERY_ENGINE_EMBEDDING_MODEL = process.env.DISCOVERY_ENGINE_EMBEDDING_MODEL || 'gemini-embedding-001';
export const EMBEDDING_API_BATCH_SIZE = 25;
export const INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE = 100;
export const TOKENS_PER_MINUTE_QUOTA = 200_000;

let testOverrideDataStoreId: string | undefined;

/**
 * Creates a DocumentServiceClient for a specific location.
 * @param location The Google Cloud location (e.g., 'global', 'us').
 */
export function createDocumentServiceClient(location: string): DocumentServiceClient {
	return new DocumentServiceClient({
		apiEndpoint: `${location}-discoveryengine.googleapis.com`,
	});
}

/**
 * Returns a singleton DocumentServiceClient for the default location.
 */
export function getDocumentServiceClient(): DocumentServiceClient {
	return createDocumentServiceClient(DISCOVERY_ENGINE_LOCATION);
}

/**
 * Returns a singleton SearchServiceClient for the default location.
 */
export function getSearchServiceClient(): SearchServiceClient {
	return createSearchServiceClient(DISCOVERY_ENGINE_LOCATION);
}

/**
 * Returns the full resource path for the data store branch.
 */
export function getDiscoveryEngineDataStorePath(): string {
	const branchId = 'default_branch';
	return getDocumentServiceClient().projectLocationCollectionDataStoreBranchPath(
		GCLOUD_PROJECT,
		DISCOVERY_ENGINE_LOCATION,
		DISCOVERY_ENGINE_COLLECTION_ID,
		testOverrideDataStoreId ?? DISCOVERY_ENGINE_DATA_STORE_ID,
		branchId,
	);
}

/**
 * Test-only function to override the data store ID.
 */
export function setDiscoveryEngineDataStoreIdForTesting(id: string | undefined): void {
	testOverrideDataStoreId = id;
}

/**
 * Creates a SearchServiceClient for a specific location.
 * @param location The Google Cloud location (e.g., 'global', 'us').
 */
export function createSearchServiceClient(location: string): SearchServiceClient {
	return new SearchServiceClient({
		apiEndpoint: `${location}-discoveryengine.googleapis.com`,
	});
}

/**
 * Creates a DataStoreServiceClient for a specific location.
 * @param location The Google Cloud location (e.g., 'global', 'us').
 */
export function createDataStoreServiceClient(location: string): DataStoreServiceClient {
	return new DataStoreServiceClient({
		apiEndpoint: `${location}-discoveryengine.googleapis.com`,
	});
}
