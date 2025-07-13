import { DocumentServiceClient, SearchServiceClient } from '@google-cloud/discoveryengine';
import { envVar } from '#utils/env-var';

// Configuration constants (replace with your actual values or environment variable handling)
const GCLOUD_PROJECT = envVar('GCLOUD_PROJECT');
const GCLOUD_REGION = envVar('GCLOUD_REGION', 'us-central1');
const DISCOVERY_ENGINE_LOCATION = envVar('DISCOVERY_ENGINE_LOCATION', 'global'); // e.g., 'global', 'us', 'eu'
const DISCOVERY_ENGINE_COLLECTION_ID = envVar('DISCOVERY_ENGINE_COLLECTION_ID', 'default_collection');
let DISCOVERY_ENGINE_DATA_STORE_ID = envVar('DISCOVERY_ENGINE_DATA_STORE_ID'); // Your Data Store ID

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
	const branchId = 'default_branch';
	// This path is for the BRANCH, which is the parent for importing documents.
	return getDocumentServiceClient().projectLocationCollectionDataStoreBranchPath(
		GCLOUD_PROJECT,
		DISCOVERY_ENGINE_LOCATION,
		DISCOVERY_ENGINE_COLLECTION_ID,
		DISCOVERY_ENGINE_DATA_STORE_ID,
		branchId,
	);
}

export function getDiscoveryEngineServingConfigPath(): string {
	// Default serving config is often 'default_config'
	const servingConfigId = 'default_config';
	return getSearchServiceClient().projectLocationCollectionDataStoreServingConfigPath(
		GCLOUD_PROJECT,
		DISCOVERY_ENGINE_LOCATION,
		DISCOVERY_ENGINE_COLLECTION_ID,
		DISCOVERY_ENGINE_DATA_STORE_ID,
		servingConfigId,
	);
}

// TEST-ONLY FUNCTION
export function resetDiscoveryEngineClients_forTesting() {
	documentServiceClient = null;
	searchServiceClient = null;
}

// TEST-ONLY FUNCTION
export function setDiscoveryEngineDataStoreIdForTesting(id: string | undefined) {
	DISCOVERY_ENGINE_DATA_STORE_ID = id ?? '';
	// Force new clients to pick up the new endpoint
	resetDiscoveryEngineClients_forTesting();
}

// Export constants for use elsewhere if needed
export const DISCOVERY_ENGINE_EMBEDDING_MODEL = process.env.DISCOVERY_ENGINE_EMBEDDING_MODEL || 'gemini-embedding-001';
export const EMBEDDING_API_BATCH_SIZE = 25; // Max texts per single API call to Vertex AI by embedder.ts
export const INDEXER_EMBEDDING_PROCESSING_BATCH_SIZE = 100; // Number of chunks indexer.ts will collect before calling generateEmbeddings
export { GCLOUD_PROJECT, GCLOUD_REGION, DISCOVERY_ENGINE_LOCATION, DISCOVERY_ENGINE_DATA_STORE_ID, DISCOVERY_ENGINE_COLLECTION_ID };
