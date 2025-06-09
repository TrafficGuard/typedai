import * as discoveryEngine from '@google-cloud/discoveryengine';
import { envVar } from '#utils/env-var';

// Placeholder for singleton client instances
let documentServiceClient: discoveryEngine.v1.DocumentServiceClient | null = null;
let searchServiceClient: discoveryEngine.v1.SearchServiceClient | null = null;

const DEFAULT_LOCATION = 'global';
const DEFAULT_SERVING_CONFIG = 'default_config';

export function getDocumentServiceClient(): discoveryEngine.v1.DocumentServiceClient {
	if (!documentServiceClient) {
		const location = process.env.DISCOVERY_ENGINE_LOCATION || DEFAULT_LOCATION;
		documentServiceClient = new discoveryEngine.DocumentServiceClient({
			apiEndpoint: `${location}-discoveryengine.googleapis.com`,
		});
	}
	return documentServiceClient;
}

export function getSearchServiceClient(): discoveryEngine.v1.SearchServiceClient {
	if (!searchServiceClient) {
		const location = process.env.DISCOVERY_ENGINE_LOCATION || DEFAULT_LOCATION;
		searchServiceClient = new discoveryEngine.SearchServiceClient({
			apiEndpoint: `${location}-discoveryengine.googleapis.com`,
		});
	}
	return searchServiceClient;
}

export function getDiscoveryEngineDataStorePath(): string {
	const client = getDocumentServiceClient();
	const project = envVar('GCLOUD_PROJECT');
	const location = process.env.DISCOVERY_ENGINE_LOCATION || DEFAULT_LOCATION;
	const dataStoreId = envVar('DISCOVERY_ENGINE_DATA_STORE_ID');
	return client.projectLocationDataStorePath(project, location, dataStoreId);
}

export function getDiscoveryEngineServingConfigPath(): string {
	const client = getSearchServiceClient();
	const project = envVar('GCLOUD_PROJECT');
	const location = process.env.DISCOVERY_ENGINE_LOCATION || DEFAULT_LOCATION;
	const dataStoreId = envVar('DISCOVERY_ENGINE_DATA_STORE_ID');
	return client.projectLocationDataStoreServingConfigPath(project, location, dataStoreId, DEFAULT_SERVING_CONFIG);
}

// Test helper to reset clients - uncomment if needed for tests
// export function _resetClientsForTest() {
//     documentServiceClient = null;
//     searchServiceClient = null;
// }
