import axios from 'axios';
import { expect } from 'chai';
import sinon from 'sinon';
import { createOllamaDualEmbedder } from './ollamaDualEmbedder';
import { OLLAMA_EMBEDDING_MODELS, OllamaEmbedderAdapter, createNomicCodeEmbedder, createQwen3Embedder } from './ollamaEmbedder';

describe('OllamaEmbedder', () => {
	const apiUrl = 'http://localhost:11434';
	let axiosPostStub: sinon.SinonStub;
	let axiosGetStub: sinon.SinonStub;

	beforeEach(() => {
		axiosPostStub = sinon.stub(axios, 'post');
		axiosGetStub = sinon.stub(axios, 'get');
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('OllamaEmbedderAdapter', () => {
		it('generates embedding for single text', async () => {
			const embedding = Array(768).fill(0.1);

			axiosPostStub.resolves({
				data: { embeddings: [embedding] },
			});

			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'nomic-embed-code',
				dimension: 768,
			});

			const result = await embedder.embed('function hello() { return "world"; }');

			expect(result).to.deep.equal(embedding);
			expect(result.length).to.equal(768);
			expect(axiosPostStub.calledOnce).to.equal(true);
			expect(axiosPostStub.firstCall.args[0]).to.equal(`${apiUrl}/api/embed`);
			expect(axiosPostStub.firstCall.args[1].model).to.equal('nomic-embed-code');
		});

		it('generates embeddings for batch of texts', async () => {
			const embedding1 = Array(768).fill(0.1);
			const embedding2 = Array(768).fill(0.2);

			axiosPostStub.resolves({
				data: { embeddings: [embedding1, embedding2] },
			});

			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'nomic-embed-code',
				dimension: 768,
			});

			const results = await embedder.embedBatch(['text one', 'text two']);

			expect(results).to.have.length(2);
			expect(results[0]).to.deep.equal(embedding1);
			expect(results[1]).to.deep.equal(embedding2);
			expect(axiosPostStub.firstCall.args[1].input).to.deep.equal(['text one', 'text two']);
		});

		it('returns correct dimension', () => {
			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'test-model',
				dimension: 1024,
			});

			expect(embedder.getDimension()).to.equal(1024);
		});

		it('returns correct model name', () => {
			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'qwen3:8b',
				dimension: 4096,
			});

			expect(embedder.getModel()).to.equal('qwen3:8b');
		});

		it('handles empty batch', async () => {
			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'test-model',
				dimension: 768,
			});

			const results = await embedder.embedBatch([]);

			expect(results).to.deep.equal([]);
			expect(axiosPostStub.called).to.equal(false);
		});

		it('throws when no embeddings returned', async () => {
			axiosPostStub.resolves({
				data: { embeddings: [] },
			});

			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'test-model',
				dimension: 768,
			});

			try {
				await embedder.embed('test');
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as Error).message).to.include('No embeddings returned');
			}
		});

		it('throws when batch embeddings count mismatch', async () => {
			axiosPostStub.resolves({
				data: { embeddings: [Array(768).fill(0.1)] }, // Only 1 embedding for 2 inputs
			});

			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'test-model',
				dimension: 768,
			});

			try {
				await embedder.embedBatch(['text1', 'text2']);
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as Error).message).to.include('Expected 2 embeddings');
			}
		});

		it('checks availability correctly when model exists', async () => {
			axiosGetStub.resolves({
				data: { models: [{ name: 'qwen3:8b' }, { name: 'nomic-embed-code' }] },
			});

			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'qwen3:8b',
				dimension: 4096,
			});

			const available = await embedder.isAvailable();
			expect(available).to.equal(true);
		});

		it('checks availability correctly when model does not exist', async () => {
			axiosGetStub.resolves({
				data: { models: [{ name: 'other-model' }] },
			});

			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'qwen3:8b',
				dimension: 4096,
			});

			const available = await embedder.isAvailable();
			expect(available).to.equal(false);
		});

		it('returns false for availability when Ollama is not reachable', async () => {
			axiosGetStub.rejects(new Error('Connection refused'));

			const embedder = new OllamaEmbedderAdapter({
				apiUrl,
				model: 'qwen3:8b',
				dimension: 4096,
			});

			const available = await embedder.isAvailable();
			expect(available).to.equal(false);
		});
	});

	describe('factory functions', () => {
		it('createQwen3Embedder creates correct configuration', () => {
			const embedder = createQwen3Embedder('http://custom:11434');

			expect(embedder.getModel()).to.equal(OLLAMA_EMBEDDING_MODELS.QWEN3_8B.model);
			expect(embedder.getDimension()).to.equal(OLLAMA_EMBEDDING_MODELS.QWEN3_8B.dimension);
		});

		it('createNomicCodeEmbedder creates correct configuration', () => {
			const embedder = createNomicCodeEmbedder();

			expect(embedder.getModel()).to.equal(OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.model);
			expect(embedder.getDimension()).to.equal(OLLAMA_EMBEDDING_MODELS.NOMIC_EMBED_CODE.dimension);
		});
	});

	describe('OllamaDualEmbeddingGenerator', () => {
		it('generates dual embeddings when enabled', async () => {
			const textEmbedding = Array(4096).fill(0.1);
			const codeEmbedding = Array(768).fill(0.2);

			// First call for code, second for text (parallel execution)
			axiosPostStub.onFirstCall().resolves({ data: { embeddings: [codeEmbedding] } });
			axiosPostStub.onSecondCall().resolves({ data: { embeddings: [textEmbedding] } });

			const dualEmbedder = createOllamaDualEmbedder({
				ollama: { apiUrl },
				chunking: { dualEmbedding: true, contextualChunking: false },
			});

			const result = await dualEmbedder.generateDualEmbeddings('function hello() { return "hello"; }', 'A function that returns hello', {
				chunking: { dualEmbedding: true, contextualChunking: false },
			});

			expect(result.codeEmbedding).to.deep.equal(codeEmbedding);
			expect(result.naturalLanguageEmbedding).to.deep.equal(textEmbedding);
			expect(axiosPostStub.calledTwice).to.equal(true);
		});

		it('generates only code embedding when dual embedding disabled', async () => {
			const codeEmbedding = Array(768).fill(0.2);

			axiosPostStub.resolves({ data: { embeddings: [codeEmbedding] } });

			const dualEmbedder = createOllamaDualEmbedder({
				ollama: { apiUrl },
				chunking: { dualEmbedding: false, contextualChunking: false },
			});

			const result = await dualEmbedder.generateDualEmbeddings('function hello() {}', 'A hello function', {
				chunking: { dualEmbedding: false, contextualChunking: false },
			});

			expect(result.codeEmbedding).to.deep.equal(codeEmbedding);
			expect(result.naturalLanguageEmbedding).to.deep.equal([]);
			expect(axiosPostStub.calledOnce).to.equal(true);
		});

		it('generates query embedding using text embedder', async () => {
			const queryEmbedding = Array(4096).fill(0.3);

			axiosPostStub.resolves({ data: { embeddings: [queryEmbedding] } });

			const dualEmbedder = createOllamaDualEmbedder({
				ollama: { apiUrl },
				chunking: { dualEmbedding: true, contextualChunking: false },
			});

			const result = await dualEmbedder.generateQueryEmbedding('find authentication logic', {
				chunking: { dualEmbedding: true, contextualChunking: false },
			});

			expect(result).to.deep.equal(queryEmbedding);
			// Should use text model (qwen3) for queries
			expect(axiosPostStub.firstCall.args[1].model).to.equal('qwen3-embedding:8b');
		});

		it('generates batch dual embeddings', async () => {
			const textEmbeddings = [Array(4096).fill(0.1), Array(4096).fill(0.2)];
			const codeEmbeddings = [Array(768).fill(0.3), Array(768).fill(0.4)];

			// Batch calls - code first, then text
			axiosPostStub.onFirstCall().resolves({ data: { embeddings: codeEmbeddings } });
			axiosPostStub.onSecondCall().resolves({ data: { embeddings: textEmbeddings } });

			const dualEmbedder = createOllamaDualEmbedder({
				ollama: { apiUrl },
				chunking: { dualEmbedding: true, contextualChunking: false },
			});

			const results = await dualEmbedder.generateDualEmbeddingsBatch(['code 1', 'code 2'], ['desc 1', 'desc 2'], {
				chunking: { dualEmbedding: true, contextualChunking: false },
			});

			expect(results).to.have.length(2);
			expect(results[0].codeEmbedding).to.deep.equal(codeEmbeddings[0]);
			expect(results[0].naturalLanguageEmbedding).to.deep.equal(textEmbeddings[0]);
			expect(results[1].codeEmbedding).to.deep.equal(codeEmbeddings[1]);
			expect(results[1].naturalLanguageEmbedding).to.deep.equal(textEmbeddings[1]);
		});

		it('throws when batch arrays have different lengths', async () => {
			const dualEmbedder = createOllamaDualEmbedder({
				ollama: { apiUrl },
				chunking: { dualEmbedding: true, contextualChunking: false },
			});

			try {
				await dualEmbedder.generateDualEmbeddingsBatch(['code1', 'code2'], ['desc1'], {
					chunking: { dualEmbedding: true, contextualChunking: false },
				});
				expect.fail('Should have thrown');
			} catch (error) {
				expect((error as Error).message).to.include('must have the same length');
			}
		});
	});
});
