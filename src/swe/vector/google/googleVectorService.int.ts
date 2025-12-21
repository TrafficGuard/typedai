import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import { logger } from '#o11y/logger';
import { sleep } from '#utils/async-utils';
import { ChunkSearchResult } from '../chunking/chunkTypes';
import { GoogleVectorServiceConfig, getGoogleVectorServiceConfig } from './googleVectorConfig';
import { GoogleVectorStore } from './googleVectorService';

describe('GoogleVectorStore Integration Test', function () {
	this.timeout(300000); // 5 minutes

	let vectorStore: GoogleVectorStore;
	let testDataStoreId: string;

	before(async () => {
		const baseConfig = getGoogleVectorServiceConfig();
		const uniqueSuffix = Date.now();
		testDataStoreId = `test-datastore-${uniqueSuffix}`;

		const config: GoogleVectorServiceConfig = {
			...baseConfig,
			dataStoreId: testDataStoreId,
		};
		vectorStore = new GoogleVectorStore(config);

		await vectorStore.createDataStore();
		logger.debug(`Created/ensured test data store with ID: ${testDataStoreId}`);
	});

	after(async () => {
		try {
			await vectorStore.deleteDataStore();
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

		await vectorStore.indexRepository(repoTempDir);

		// This delay is required for the indexing to complete
		await sleep(8000);

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
