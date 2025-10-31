import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect } from 'chai';
import pino from 'pino';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { VectorStoreConfig } from './core/config';
import { getGoogleVectorServiceConfig } from './google/googleVectorConfig';
import { VectorSearchOrchestrator } from './google/vectorSearchOrchestrator';
import { cleanupTempDir, createMinimalTestRepo, createTestDataStoreId, waitForIndexing } from './test/testUtils';

const logger = pino({ name: 'IncrementalSyncTest' });

describe('Incremental Sync Integration Tests', function () {
	setupConditionalLoggerOutput();
	this.timeout(300000); // 5 minutes per test

	let orchestrator: VectorSearchOrchestrator;
	let testDataStoreId: string;
	let testRepoDir: string;

	// Fast config for all tests (no LLM features)
	const testConfig: VectorStoreConfig = {
		dualEmbedding: false,
		contextualChunking: false,
		chunkSize: 2500,
	};

	before(async () => {
		// Create unique test data store
		testDataStoreId = createTestDataStoreId('incremental-sync');
		logger.info({ testDataStoreId }, 'Created test data store ID');

		const googleConfig = getGoogleVectorServiceConfig();
		googleConfig.dataStoreId = testDataStoreId;
		orchestrator = new VectorSearchOrchestrator(googleConfig);

		logger.info('Orchestrator initialized');
	});

	after(async () => {
		// Cleanup: delete test data store
		try {
			logger.info('Cleaning up test data store');
			await orchestrator.deleteDataStore();
		} catch (err) {
			logger.error({ err }, 'Failed to cleanup test data store');
		}
	});

	beforeEach(async () => {
		// Create temp repo for each test
		testRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'incremental-sync-'));
		logger.debug({ testRepoDir }, 'Created temp test directory');
	});

	afterEach(async () => {
		// Cleanup temp repo
		await cleanupTempDir(testRepoDir);

		// Purge data store between tests
		try {
			await orchestrator.purgeAll();
			await waitForIndexing(); // Wait for purge to complete
		} catch (err) {
			logger.warn({ err }, 'Failed to purge data store');
		}
	});

	describe('1. Auto-Detection', () => {
		it('should perform full index when data store is empty', async () => {
			// Create test repo
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const a = 1;',
				'src/file2.ts': 'export const b = 2;',
			});

			// Verify data store is empty
			const docsBeforeIndex = await orchestrator.listDocuments(10);
			expect(docsBeforeIndex).to.have.length(0);

			// Index with incremental=false (simulating auto-detection of empty store)
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});

			await waitForIndexing(orchestrator, 'export');

			// Verify documents were indexed
			const results = await orchestrator.search('export const', { maxResults: 10 });
			expect(results).to.have.length.greaterThan(0);

			logger.info('✓ Full index completed on empty data store');
		});

		it('should perform incremental update when data store has entries', async () => {
			// Create initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const a = 1;',
			});

			// Initial full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify data store has entries
			const docsAfterInitial = await orchestrator.listDocuments(10);
			expect(docsAfterInitial).to.have.length.greaterThan(0);

			// Add new file
			await fs.writeFile(path.join(testRepoDir, 'src/file2.ts'), 'export const b = 2;');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify both files are searchable
			const results = await orchestrator.search('export const', { maxResults: 10 });
			const files = results.map((r) => path.basename(r.document.filePath));
			expect(files).to.include('file2.ts');

			logger.info('✓ Incremental update completed on existing data store');
		});

		it('should detect changes correctly after auto-detection', async () => {
			// Initial repo with 2 files
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const original1 = 1;',
				'src/file2.ts': 'export const original2 = 2;',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'original');

			// Modify file1, add file3
			await fs.writeFile(path.join(testRepoDir, 'src/file1.ts'), 'export const modified1 = 10;');
			await fs.writeFile(path.join(testRepoDir, 'src/file3.ts'), 'export const new3 = 3;');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'modified');

			// Search for modified content
			const modifiedResults = await orchestrator.search('modified1', { maxResults: 5 });
			expect(modifiedResults).to.have.length.greaterThan(0);

			// Search for new file
			const newResults = await orchestrator.search('new3', { maxResults: 5 });
			expect(newResults).to.have.length.greaterThan(0);

			// Old content should not be found
			const oldResults = await orchestrator.search('original1', { maxResults: 5 });
			expect(oldResults).to.have.length(0);

			logger.info('✓ Changes detected and applied correctly');
		});
	});

	describe('2. Basic Incremental Operations', () => {
		it('should detect and index added files', async () => {
			// Initial repo with 1 file
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const a = 1;',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Add 3 new files
			await fs.writeFile(path.join(testRepoDir, 'src/file2.ts'), 'export const b = 2;');
			await fs.writeFile(path.join(testRepoDir, 'src/file3.ts'), 'export const c = 3;');
			await fs.writeFile(path.join(testRepoDir, 'src/file4.ts'), 'export const d = 4;');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify all 4 files are searchable
			const results = await orchestrator.search('export const', { maxResults: 10 });
			const fileNames = results.map((r) => path.basename(r.document.filePath));

			expect(fileNames).to.include('file2.ts');
			expect(fileNames).to.include('file3.ts');
			expect(fileNames).to.include('file4.ts');

			logger.info({ addedFiles: 3 }, '✓ Added files detected and indexed');
		});

		it('should detect and reindex modified files', async () => {
			// Initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/math.ts': 'export function add(a, b) { return a + b; }',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'add');

			// Verify original content
			const originalResults = await orchestrator.search('add', { maxResults: 5 });
			expect(originalResults).to.have.length.greaterThan(0);

			// Modify file
			await fs.writeFile(path.join(testRepoDir, 'src/math.ts'), 'export function multiply(a, b) { return a * b; } // Modified function');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'multiply');

			// Verify new content is searchable
			const newResults = await orchestrator.search('multiply', { maxResults: 5 });
			expect(newResults).to.have.length.greaterThan(0);

			// Old content should not be found
			const oldResults = await orchestrator.search('add', { maxResults: 5 });
			expect(oldResults).to.have.length(0);

			logger.info('✓ Modified file detected and reindexed');
		});

		it('should detect and remove deleted files', async () => {
			// Initial repo with 3 files
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const a = 1;',
				'src/file2.ts': 'export const b = 2;',
				'src/file3.ts': 'export const c = 3;',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify all files are searchable
			const initialResults = await orchestrator.search('export const', { maxResults: 10 });
			expect(initialResults.length).to.be.greaterThan(0);

			// Delete file2
			await fs.unlink(path.join(testRepoDir, 'src/file2.ts'));

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify file2 is not searchable
			const results = await orchestrator.search('export const', { maxResults: 10 });
			const hasFile2 = results.some((r) => r.document.filePath.includes('file2'));
			expect(hasFile2).to.be.false;

			// Verify file1 and file3 are still searchable
			const hasFile1 = results.some((r) => r.document.filePath.includes('file1'));
			const hasFile3 = results.some((r) => r.document.filePath.includes('file3'));
			expect(hasFile1).to.be.true;
			expect(hasFile3).to.be.true;

			logger.info('✓ Deleted file removed from index');
		});

		it('should handle mixed changes (add + modify + delete)', async () => {
			// Initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const a = 1;',
				'src/file2.ts': 'export const b = 2;',
				'src/file3.ts': 'export const c = 3;',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Mixed changes:
			// - Modify file1
			// - Add file4
			// - Delete file3
			await fs.writeFile(path.join(testRepoDir, 'src/file1.ts'), 'export const a = 100; // Modified');
			await fs.writeFile(path.join(testRepoDir, 'src/file4.ts'), 'export const d = 4; // New file');
			await fs.unlink(path.join(testRepoDir, 'src/file3.ts'));

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify results
			const results = await orchestrator.search('export const', { maxResults: 10 });

			// file1 should have modified content
			const file1Results = results.filter((r) => r.document.filePath.includes('file1'));
			expect(file1Results.some((r) => r.document.originalCode.includes('100'))).to.be.true;

			// file4 should exist
			const hasFile4 = results.some((r) => r.document.filePath.includes('file4'));
			expect(hasFile4).to.be.true;

			// file3 should not exist
			const hasFile3 = results.some((r) => r.document.filePath.includes('file3'));
			expect(hasFile3).to.be.false;

			// file2 should still exist (unchanged)
			const hasFile2 = results.some((r) => r.document.filePath.includes('file2'));
			expect(hasFile2).to.be.true;

			logger.info('✓ Mixed changes handled correctly');
		});
	});

	describe('3. Edge Cases', () => {
		it('should handle empty directories', async () => {
			// Create empty directory
			await fs.mkdir(path.join(testRepoDir, 'src'), { recursive: true });
			await fs.mkdir(path.join(testRepoDir, 'src/empty'), { recursive: true });

			// Add one file outside the empty dir
			await fs.writeFile(path.join(testRepoDir, 'src/file1.ts'), 'export const a = 1;');

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Add file to previously empty directory
			await fs.writeFile(path.join(testRepoDir, 'src/empty/file2.ts'), 'export const b = 2;');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify both files are searchable
			const results = await orchestrator.search('export const', { maxResults: 10 });
			expect(results.length).to.be.greaterThan(0);
			const hasFile2 = results.some((r) => r.document.filePath.includes('file2'));
			expect(hasFile2).to.be.true;

			logger.info('✓ Empty directories handled correctly');
		});

		it('should handle nested directory structures', async () => {
			// Create nested structure
			await createMinimalTestRepo(testRepoDir, {
				'src/level1/file1.ts': 'export const a = 1;',
				'src/level1/level2/file2.ts': 'export const b = 2;',
				'src/level1/level2/level3/file3.ts': 'export const c = 3;',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Add file deep in hierarchy
			await fs.mkdir(path.join(testRepoDir, 'src/level1/level2/level3/level4'), { recursive: true });
			await fs.writeFile(path.join(testRepoDir, 'src/level1/level2/level3/level4/file4.ts'), 'export const d = 4;');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify deep file is searchable
			const results = await orchestrator.search('const d', { maxResults: 5 });
			expect(results).to.have.length.greaterThan(0);
			const hasFile4 = results.some((r) => r.document.filePath.includes('level4/file4'));
			expect(hasFile4).to.be.true;

			logger.info('✓ Nested directories handled correctly');
		});

		it('should handle file renames (detected as delete + add)', async () => {
			// Initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/oldName.ts': 'export const value = 42;',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'value');

			// Rename file (delete + add)
			await fs.unlink(path.join(testRepoDir, 'src/oldName.ts'));
			await fs.writeFile(path.join(testRepoDir, 'src/newName.ts'), 'export const value = 42;');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'value');

			// Verify old name not found
			const results = await orchestrator.search('value', { maxResults: 10 });
			const hasOldName = results.some((r) => r.document.filePath.includes('oldName'));
			expect(hasOldName).to.be.false;

			// Verify new name found
			const hasNewName = results.some((r) => r.document.filePath.includes('newName'));
			expect(hasNewName).to.be.true;

			logger.info('✓ File renames handled correctly');
		});
	});

	describe('4. Performance & Scale', () => {
		it('should incrementally update faster than full reindex', async function () {
			this.timeout(600000); // 10 minutes

			// Create repo with 50 files
			const files: Record<string, string> = {};
			for (let i = 1; i <= 50; i++) {
				files[`src/file${i}.ts`] = `export const value${i} = ${i};`;
			}
			await createMinimalTestRepo(testRepoDir, files);

			// Measure full index time
			const fullIndexStart = Date.now();
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'value');
			const fullIndexDuration = Date.now() - fullIndexStart;

			logger.info({ fullIndexDuration }, 'Full index completed');

			// Modify 5 files (10% of total)
			for (let i = 1; i <= 5; i++) {
				await fs.writeFile(path.join(testRepoDir, `src/file${i}.ts`), `export const value${i} = ${i * 10}; // Modified`);
			}

			// Measure incremental update time
			const incrementalStart = Date.now();
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'value');
			const incrementalDuration = Date.now() - incrementalStart;

			logger.info({ incrementalDuration, fullIndexDuration }, 'Incremental update completed');

			// Incremental should be significantly faster (at least 30% faster)
			const speedup = ((fullIndexDuration - incrementalDuration) / fullIndexDuration) * 100;
			logger.info({ speedup: `${speedup.toFixed(1)}%` }, 'Performance improvement');

			expect(incrementalDuration).to.be.lessThan(fullIndexDuration * 0.7); // At least 30% faster

			// Verify correctness
			const results = await orchestrator.search('value1', { maxResults: 5 });
			const modifiedFile = results.find((r) => r.document.filePath.includes('file1'));
			expect(modifiedFile?.document.originalCode).to.include('Modified');
		});

		it('should handle rapid successive syncs', async () => {
			// Initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const a = 1;',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Perform 3 rapid incremental updates
			for (let i = 2; i <= 4; i++) {
				await fs.writeFile(path.join(testRepoDir, `src/file${i}.ts`), `export const x${i} = ${i};`);

				await orchestrator.indexRepository(testRepoDir, {
					incremental: true,
					config: testConfig,
				});
				await waitForIndexing(orchestrator, 'export');
			}

			// Verify all files are searchable
			const results = await orchestrator.search('export const', { maxResults: 10 });
			expect(results.length).to.be.greaterThan(0);

			const fileNames = results.map((r) => path.basename(r.document.filePath));
			expect(fileNames).to.include('file4.ts');

			logger.info('✓ Rapid successive syncs handled correctly');
		});
	});

	describe('5. Snapshot Management', () => {
		it('should persist snapshots between runs', async () => {
			// Create initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const a = 1;',
			});

			// First full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Add new file
			await fs.writeFile(path.join(testRepoDir, 'src/file2.ts'), 'export const b = 2;');

			// Second run - incremental (should use snapshot)
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'export');

			// Verify both files searchable
			const results = await orchestrator.search('export const', { maxResults: 10 });
			const fileNames = results.map((r) => path.basename(r.document.filePath));
			expect(fileNames).to.include('file1.ts');
			expect(fileNames).to.include('file2.ts');

			logger.info('✓ Snapshot persisted and used correctly');
		});
	});

	describe('6. Verification', () => {
		it('should maintain search accuracy after incremental updates', async () => {
			// Initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/math.ts': 'export function add(a: number, b: number) { return a + b; }',
				'src/string.ts': 'export function concat(a: string, b: string) { return a + b; }',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'function');

			// Search before modification
			const beforeResults = await orchestrator.search('add', { maxResults: 10 });
			expect(beforeResults.length).to.be.greaterThan(0);

			// Modify one file
			await fs.writeFile(path.join(testRepoDir, 'src/math.ts'), 'export function multiply(a: number, b: number) { return a * b; }');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'multiply');

			// Verify search accuracy
			const multiplyResults = await orchestrator.search('multiply', { maxResults: 10 });
			expect(multiplyResults).to.have.length.greaterThan(0);

			const concatResults = await orchestrator.search('concat', { maxResults: 10 });
			expect(concatResults).to.have.length.greaterThan(0);
			expect(concatResults.some((r) => r.document.filePath.includes('string.ts'))).to.be.true;

			logger.info('✓ Search accuracy maintained after updates');
		});

		it('should verify deleted files are not searchable', async () => {
			// Initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/file1.ts': 'export const unique1 = 1;',
				'src/file2.ts': 'export const unique2 = 2;',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'unique');

			// Verify both searchable
			const beforeResults = await orchestrator.search('unique', { maxResults: 10 });
			expect(beforeResults.length).to.equal(2);

			// Delete file1
			await fs.unlink(path.join(testRepoDir, 'src/file1.ts'));

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'unique');

			// Verify unique1 not searchable
			const afterResults = await orchestrator.search('unique1', { maxResults: 10 });
			expect(afterResults).to.have.length(0);

			// Verify unique2 still searchable
			const unique2Results = await orchestrator.search('unique2', { maxResults: 10 });
			expect(unique2Results).to.have.length.greaterThan(0);

			logger.info('✓ Deleted files not searchable');
		});

		it('should verify modified files reflect new content', async () => {
			// Initial repo
			await createMinimalTestRepo(testRepoDir, {
				'src/config.ts': 'export const VERSION = "1.0.0";',
			});

			// Full index
			await orchestrator.indexRepository(testRepoDir, {
				incremental: false,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'VERSION');

			// Verify old version searchable
			const beforeResults = await orchestrator.search('1.0.0', { maxResults: 5 });
			expect(beforeResults).to.have.length.greaterThan(0);

			// Modify file
			await fs.writeFile(path.join(testRepoDir, 'src/config.ts'), 'export const VERSION = "2.0.0";');

			// Incremental update
			await orchestrator.indexRepository(testRepoDir, {
				incremental: true,
				config: testConfig,
			});
			await waitForIndexing(orchestrator, 'VERSION');

			// Verify new version searchable
			const newResults = await orchestrator.search('2.0.0', { maxResults: 5 });
			expect(newResults).to.have.length.greaterThan(0);

			// Verify old version not searchable
			const oldResults = await orchestrator.search('1.0.0', { maxResults: 5 });
			expect(oldResults).to.have.length(0);

			logger.info('✓ Modified files reflect new content');
		});
	});
});
