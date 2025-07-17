import { expect } from 'chai';
import pino from 'pino';
import { DISCOVERY_ENGINE_EMBEDDING_MODEL, DISCOVERY_ENGINE_LOCATION, GCLOUD_PROJECT, GCLOUD_REGION, GoogleVectorServiceConfig } from './config';
import { GoogleVectorStore } from './googleVectorService';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { sleep } from '#utils/async-utils';
import { ChunkSearchResult } from '../chunking/chunkTypes';

const logger = pino({ name: 'GoogleVectorStoreIntTest' });

describe('GoogleVectorStore Integration Test', function () {
	this.timeout(300000); // 5 minutes

	const project = GCLOUD_PROJECT;
	const region = GCLOUD_REGION;
	const location = DISCOVERY_ENGINE_LOCATION;
	const collection = 'default_collection';

	let vectorStore: GoogleVectorStore;

	before(async () => {
		const uniqueSuffix = Date.now();
		const dataStoreId = `test-datastore-${uniqueSuffix}`;

		const config: GoogleVectorServiceConfig = {
			project,
			region,
			discoveryEngineLocation: location,
			collection,
			dataStoreId,
			embeddingModel: DISCOVERY_ENGINE_EMBEDDING_MODEL,
		};
		vectorStore = new GoogleVectorStore(config);

		await vectorStore.createDataStore();
		logger.info(`Created/ensured test data store with ID: ${dataStoreId}`);
	});

	after(async () => {
		try {
			await vectorStore.deleteDataStore();
			logger.info(`Deleted test data store: ${vectorStore.config.dataStoreId}`);
		} catch (err) {
			logger.error({ err }, 'Failed to delete test data store');
		}
	});

	it('should successfully index a directory and retrieve search results', async () => {
		// Create temp dir with sample file
		const repoTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-test-'));
		const filePath = 'adder.js';
		const sampleFile = path.join(repoTempDir, filePath);
		await fs.writeFile(sampleFile, 'function calculateSum(a, b) { return a + b; }');

		// Index using GoogleVectorStore
		await vectorStore.indexRepository(repoTempDir);

		// Short delay for indexing to propagate (adjust as needed for real API)
		await sleep(5000);

		// Search and assert
		const query = 'a function that adds two numbers';
		const results: ChunkSearchResult[] = await vectorStore.search(query);
		expect(results).to.be.an('array').with.length.greaterThan(0);
		const found = results[0];
		expect(found.document.filePath).to.equal(filePath);
		expect(found.document.originalCode).to.include('calculateSum');

		// Cleanup temp dir
		await fs.rm(repoTempDir, { recursive: true });
	});
});
