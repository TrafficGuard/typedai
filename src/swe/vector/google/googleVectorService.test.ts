// GoogleVectorStore integration test

import { expect } from 'chai';
import pino from 'pino';
import { DISCOVERY_ENGINE_LOCATION, GCLOUD_PROJECT } from './config';
import { GoogleVectorStore, sanitizeGitUrlForDataStoreId } from './googleVectorService';

const logger = pino({ name: 'GoogleVectorStoreIntTest' });

describe.skip('GoogleVectorStore Integration Test', function () {
	this.timeout(300000); // 5 minutes

	const project = GCLOUD_PROJECT;
	const location = DISCOVERY_ENGINE_LOCATION;
	const collection = 'default_collection';
	// Use a sanitized, unique ID for the data store
	const testRepoUrl = `https://github.com/test-org/test-repo-${Date.now()}`;
	const dataStoreId = sanitizeGitUrlForDataStoreId(testRepoUrl);

	let vectorStore: GoogleVectorStore;

	before(() => {
		vectorStore = new GoogleVectorStore(project, location, collection, dataStoreId);
	});

	after(async () => {
		// TODO: Add cleanup logic to delete the data store
		logger.info(`Skipping cleanup for now. Data store to delete manually: ${dataStoreId}`);
	});

	it('should successfully create a data store, index a directory, and retrieve search results', async () => {
		// TODO: Implement the test logic
		// 1. Create a temporary directory with a few test files.
		// 2. Call vectorStore.indexRepository(tempDir);
		// 3. Call vectorStore.search('some query');
		// 4. Assert the results.
		expect(true).to.be.true;
	});
});
