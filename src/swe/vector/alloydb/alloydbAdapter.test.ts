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
			chunking: {
				dualEmbedding: false,
				contextualChunking: true,
			},
			search: { hybridSearch: true },
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
		beforeEach(() => {
			queryStub.resolves({ rows: [] });
		});

		it('uses manual embeddings in vector search when automated embeddings are disabled', async () => {
			await adapter.search('manual query', [0.1, 0.2], 5, { ...mockVectorConfig, search: { hybridSearch: false } });

			const sql = queryStub.firstCall.args[0];
			const params = queryStub.firstCall.args[1];
			expect(sql).to.contain('embedding <=> $1::vector');
			expect(params[0]).to.equal('[0.1,0.2]');
		});

		it('calls google_ml.embedding when automated embeddings are enabled', async () => {
			(adapter as any).automatedEmbeddingsEnabled = true;

			await adapter.search('auto query', [], 5, { ...mockVectorConfig, search: { hybridSearch: false } });

			const sql = queryStub.firstCall.args[0];
			const params = queryStub.firstCall.args[1];
			expect(sql).to.contain('google_ml.embedding');
			expect(params[0]).to.equal(mockAlloyDBConfig.embeddingModel);
			expect(params[1]).to.equal('auto query');
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
