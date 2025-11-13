import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as sinon from 'sinon';
import type { VectorStoreConfig } from '../core/config';
import type { EmbeddedChunk } from '../core/interfaces';
import { AlloyDBAdapter } from './alloydbAdapter';
import type { AlloyDBConfig } from './alloydbConfig';

describe('AlloyDBAdapter', () => {
	let adapter: AlloyDBAdapter;
	let mockAlloyDBConfig: AlloyDBConfig;
	let mockVectorConfig: VectorStoreConfig;
	let queryStub: sinon.SinonStub;
	let connectStub: sinon.SinonStub;

	beforeEach(() => {
		mockAlloyDBConfig = {
			database: 'test_db',
			host: 'localhost',
			port: 5432,
			user: 'testuser',
			password: 'testpass',
			embeddingModel: 'gemini-embedding-001',
			enableColumnarEngine: true,
			vectorWeight: 0.7,
		};

		mockVectorConfig = {
			dualEmbedding: false,
			contextualChunking: true,
			hybridSearch: true,
		};

		adapter = new AlloyDBAdapter('test-repo', mockAlloyDBConfig);

		// Stub the client methods
		queryStub = sinon.stub();
		connectStub = sinon.stub().resolves({
			query: sinon.stub().resolves({ rows: [{ version: 'PostgreSQL 15.0' }] }),
			release: sinon.stub(),
		});

		// Replace client internals
		(adapter as any).client = {
			connect: connectStub,
			query: queryStub,
			checkExtensions: sinon.stub().resolves({
				vector: true,
				scann: true,
				columnarEngine: true,
			}),
			checkAutomatedEmbeddings: sinon.stub().resolves(false),
		};
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('initialize', () => {
		it('should initialize the adapter and create table', async () => {
			queryStub.resolves({ rows: [{ count: '0' }] });

			await adapter.initialize(mockVectorConfig);

			// Verify table creation was called
			expect(queryStub.calledWith(sinon.match(/CREATE TABLE IF NOT EXISTS/))).to.be.true;
		});
	});

	describe('indexChunks', () => {
		it('should index chunks in batches', async () => {
			const mockChunks: EmbeddedChunk[] = [
				{
					filePath: 'test/file1.ts',
					language: 'typescript',
					chunk: {
						content: 'function test() {}',
						sourceLocation: { startLine: 1, endLine: 3 },
						chunkType: 'function',
						contextualizedContent: 'A test function that does nothing',
					} as any,
					embedding: [0.1, 0.2, 0.3],
				},
			];

			queryStub.resolves({ rowCount: 1 });

			await adapter.indexChunks(mockChunks);

			// Verify INSERT query was called
			expect(queryStub.calledWith(sinon.match(/INSERT INTO/))).to.be.true;
		});

		it('should handle empty chunks array', async () => {
			await adapter.indexChunks([]);

			// Should not call query for empty chunks
			expect(queryStub.called).to.be.false;
		});
	});

	describe('deleteByFilePath', () => {
		it('should delete chunks by file path', async () => {
			queryStub.resolves({ rowCount: 5 });

			await adapter.deleteByFilePath('test/file.ts');

			// Verify DELETE query was called
			expect(queryStub.calledWith(sinon.match(/DELETE FROM/))).to.be.true;
		});
	});

	describe('search', () => {
		it('should perform vector search when hybridSearch is false', async () => {
			const mockResults = [
				{
					id: 'test-id',
					filename: 'test/file.ts',
					line_from: 1,
					line_to: 3,
					original_text: 'function test() {}',
					language: 'typescript',
					chunk_type: 'function',
					distance: 0.2,
				},
			];

			queryStub.resolves({ rows: mockResults });

			const config: VectorStoreConfig = {
				...mockVectorConfig,
				hybridSearch: false,
			};

			const results = await adapter.search('test query', [], 10, config);

			// Verify vector search query was called
			expect(queryStub.calledWith(sinon.match(/embedding <=>/))).to.be.true;

			// Verify results were converted correctly
			expect(results).to.have.lengthOf(1);
			expect(results[0].document.filePath).to.equal('test/file.ts');
		});

		it('should perform hybrid search when hybridSearch is true', async () => {
			const mockResults = [
				{
					id: 'test-id',
					filename: 'test/file.ts',
					line_from: 1,
					line_to: 3,
					original_text: 'function test() {}',
					language: 'typescript',
					chunk_type: 'function',
					distance: 0.2,
					vector_rank: 1,
					text_rank: 1,
					rrf_score: 0.5,
				},
			];

			queryStub.resolves({ rows: mockResults });

			const config: VectorStoreConfig = {
				...mockVectorConfig,
				hybridSearch: true,
			};

			const results = await adapter.search('test query', [], 10, config);

			// Verify hybrid search query was called (with CTEs)
			expect(queryStub.calledWith(sinon.match(/vector_results AS/))).to.be.true;

			// Verify results
			expect(results).to.have.lengthOf(1);
			expect(results[0].document.filePath).to.equal('test/file.ts');
		});
	});

	describe('getStats', () => {
		it('should return statistics about the vector store', async () => {
			queryStub.onFirstCall().resolves({ rows: [{ count: '100' }] });
			queryStub.onSecondCall().resolves({ rows: [{ size: '1024000' }] });

			const stats = await adapter.getStats();

			expect(stats.totalDocuments).to.equal(100);
			expect(stats.totalChunks).to.equal(100);
			expect(stats.storageSize).to.equal(1024000);
		});
	});

	describe('purge', () => {
		it('should delete all documents for the current config', async () => {
			queryStub.resolves({ rowCount: 100 });

			await adapter.purge();

			// Verify DELETE query was called
			expect(queryStub.calledWith(sinon.match(/DELETE FROM/))).to.be.true;
		});
	});
});
