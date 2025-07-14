// Google Vector Store integration test

import { DataStoreServiceClient, protos } from '@google-cloud/discoveryengine';
import type { google } from '@google-cloud/discoveryengine/build/protos/protos';
import { expect } from 'chai';
import { struct } from 'pb-util';
import pino from 'pino';
import { sleep } from '#utils/async-utils';
import {
	DISCOVERY_ENGINE_DATA_STORE_ID as DATA_STORE_ID_CONST,
	DISCOVERY_ENGINE_LOCATION,
	GCLOUD_PROJECT,
	getDocumentServiceClient,
	setDiscoveryEngineDataStoreIdForTesting,
} from './config';
import { generateEmbedding } from './indexing/embedder';
import { searchCode } from './search';

const logger = pino({ name: 'GoogleApiIntegrationTest' });

/**
 * This test suite is to test the usage of the @google-cloud/discoveryengine package
 * and understand the parameters, errors and responses of the API.
 */
describe.skip('Google discoveryengine API', function () {
	// Increase the timeout for the entire suite to handle resource creation/deletion.
	// 60 seconds should be sufficient.
	this.timeout(60000);
	const location = DISCOVERY_ENGINE_LOCATION;
	const collectionId = 'default_collection';
	const branchId = 'default_branch';
	// Generate a unique ID for the data store for this test run
	const testDataStoreId = `test_ds_${Date.now()}`;
	let testDataStorePath: string; // To store the full resource path

	// ===================================================================================
	//  BEFOREALL: Create the Data Store before any tests run
	// ===================================================================================
	before(async () => {
		logger.info(`BEFORE hook: Creating test data store with ID: ${testDataStoreId}...`);
		const dataStoreClient = new DataStoreServiceClient({
			apiEndpoint: `${location}-discoveryengine.googleapis.com`,
		});

		const parent = `projects/${GCLOUD_PROJECT}/locations/${location}/collections/${collectionId}`;

		testDataStorePath = `${parent}/dataStores/${testDataStoreId}`;

		try {
			const [operation] = await dataStoreClient.createDataStore({
				parent,
				dataStoreId: testDataStoreId,
				dataStore: {
					displayName: `Test Data Store - ${testDataStoreId}`,
					industryVertical: 'GENERIC',
					// This creates a data store for vector/semantic search
					solutionTypes: [protos.google.cloud.discoveryengine.v1beta.SolutionType.SOLUTION_TYPE_SEARCH],
					contentConfig: 'NO_CONTENT',
				},
			});

			logger.info('Waiting for Data Store creation operation to complete...');
			await operation.promise();
			logger.info(`Successfully created data store: ${testDataStorePath}`);
		} catch (err) {
			logger.fatal({ err }, 'Fatal error during test setup: Could not create Data Store. Halting tests.');
			// Re-throw to make sure the test suite stops if setup fails
			throw err;
		}
	});

	// ===================================================================================
	//  AFTERALL: Delete the Data Store after all tests have run
	// ===================================================================================
	after(async () => {
		logger.info(`AFTER hook: Deleting test data store: ${testDataStorePath}...`);
		const dataStoreClient = new DataStoreServiceClient({
			apiEndpoint: `${location}-discoveryengine.googleapis.com`,
		});

		try {
			const [operation] = await dataStoreClient.deleteDataStore({
				name: testDataStorePath,
			});
			logger.info('Waiting for Data Store deletion operation to complete...');
			await operation.promise();
			logger.info('Successfully deleted test data store.');
		} catch (err: any) {
			if (err.code === 5) {
				// NOT_FOUND
				logger.warn(`Data store ${testDataStorePath} was not found for deletion. It may have been cleaned up already.`);
			} else {
				logger.error({ err }, `Failed to clean up test data store: ${testDataStorePath}`);
			}
		}
	});

	it('should embed, index, and successfully retrieve a code chunk', async () => {
		// Use a unique ID for the document within this specific test
		const testDocId = `test-doc-${Date.now()}`;
		const testCodeContent = 'function calculateSum(a, b) { return a + b; }';
		const testQuery = 'a function that adds two numbers';
		const testFilePath = 'test/integration/adder.js';

		// 1. === EMBED ===
		logger.info('Step 1: Generating embedding for the test document...');
		const embedding = await generateEmbedding(testCodeContent, 'RETRIEVAL_DOCUMENT');
		expect(embedding).to.be.an('array').with.length.greaterThan(0);
		logger.info(`Embedding generated successfully. Dimension: ${embedding.length}`);

		// 2. === INDEX ===
		logger.info(`Step 2: Indexing document with ID: ${testDocId}...`);
		const documentClient = getDocumentServiceClient();
		const parentPath = `${testDataStorePath}/branches/${branchId}`;

		const document: protos.google.cloud.discoveryengine.v1beta.IDocument = {
			id: testDocId,
			structData: struct.encode({
				file_path: testFilePath,
				original_code: testCodeContent,
				embedding_vector: embedding,
				lexical_search_text: testCodeContent,
			}),
		};

		const [operation] = await documentClient.importDocuments({
			parent: parentPath,
			inlineSource: { documents: [document] },
			reconciliationMode: protos.google.cloud.discoveryengine.v1beta.ImportDocumentsRequest.ReconciliationMode.INCREMENTAL,
		});
		logger.info(`Import operation started: ${operation.name}`);
		await operation.promise();
		// Optional short cushion
		await sleep(3000);

		// 4. === QUERY ===
		// We need to override the DATA_STORE_ID used by searchCode for this test run.
		// We'll use a test-only setter to do this temporarily.
		const originalId = DATA_STORE_ID_CONST;
		setDiscoveryEngineDataStoreIdForTesting(testDataStoreId);

		logger.info(`Step 4: Performing search with query: "${testQuery}"...`);
		const results = await searchCode(testQuery, 5);

		// Restore the original ID immediately after the call
		setDiscoveryEngineDataStoreIdForTesting(originalId);

		// 5. === ASSERT ===
		logger.info('Step 5: Asserting search results...');
		expect(results).to.be.an('array').with.length.greaterThan(0);
		const foundDoc = results.find((r) => r.id === testDocId);
		expect(foundDoc).to.not.be.undefined;
		expect(foundDoc.document.filePath).to.equal(testFilePath);
	});
});
