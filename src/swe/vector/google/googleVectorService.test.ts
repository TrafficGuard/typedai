import { expect } from 'chai';
import pino from 'pino';
import { DISCOVERY_ENGINE_LOCATION, GCLOUD_PROJECT } from './config';
import { GoogleVectorStore, sanitizeGitUrlForDataStoreId } from './googleVectorService';

import { DataStoreServiceClient, protos } from '@google-cloud/discoveryengine';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const logger = pino({ name: 'GoogleVectorStoreIntTest' });

describe.skip('GoogleVectorStore Integration Test', function () {
    // Unskip and keep timeout
    describe('GoogleVectorStore Integration Test', function () {
        this.timeout(300000); // 5 minutes

        const project = GCLOUD_PROJECT;
        const location = DISCOVERY_ENGINE_LOCATION;
        const collection = 'default_collection';
        const testRepoUrl = `https://github.com/test-org/test-repo-${Date.now()}`;
        const dataStoreId = sanitizeGitUrlForDataStoreId(testRepoUrl);

        let vectorStore: GoogleVectorStore;
        let testDataStorePath: string;

        // Adapt example before: Create temp data store
        before(async () => {
            logger.info(`Creating test data store with ID: ${dataStoreId}`);
            const dataStoreClient = new DataStoreServiceClient({ apiEndpoint: `${location}-discoveryengine.googleapis.com` });
            const parent = `projects/${project}/locations/${location}/collections/${collection}`;
            testDataStorePath = `${parent}/dataStores/${dataStoreId}`;
            const [operation] = await dataStoreClient.createDataStore({
                parent,
                dataStoreId,
                dataStore: {
                    displayName: `Test Data Store - ${dataStoreId}`,
                    industryVertical: 'GENERIC',
                    solutionTypes: [protos.google.cloud.discoveryengine.v1beta.SolutionType.SOLUTION_TYPE_SEARCH],
                    contentConfig: 'NO_CONTENT',
                },
            });
            await operation.promise();
            vectorStore = new GoogleVectorStore(project, location, collection, dataStoreId);
        });

        // Adapt example after: Delete data store
        after(async () => {
            logger.info(`Deleting test data store: ${testDataStorePath}`);
            const dataStoreClient = new DataStoreServiceClient({ apiEndpoint: `${location}-discoveryengine.googleapis.com` });
            try {
                const [operation] = await dataStoreClient.deleteDataStore({ name: testDataStorePath });
                await operation.promise();
            } catch (err) {
                logger.error({ err }, 'Failed to delete test data store');
            }
        });

        it('should successfully create a data store, index a directory, and retrieve search results', async () => {
            // Create temp dir with sample file
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-test-'));
            const sampleFile = path.join(tempDir, 'adder.js');
            await fs.writeFile(sampleFile, 'function calculateSum(a, b) { return a + b; }');

            // Index
            await vectorStore.indexRepository(tempDir);  // Assume this method exists per class purpose

            // Search and assert state
            const query = 'a function that adds two numbers';
            const results = await vectorStore.search(query);
            expect(results).to.be.an('array').with.length.greaterThan(0);
            const found = results[0];  // Assume at least one
            expect(found.document.filePath).to.equal(sampleFile);
            expect(found.document.original_code).to.include('calculateSum');

            // Cleanup temp dir
            await fs.rm(tempDir, { recursive: true });
        });
    });
});