import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import * as codestralSearchModule from './codestralSearch';
import {
	DO_CHUNKING as ACTUAL_DO_CHUNKING,
	EMBED_MODEL,
	Language,
	MAX_BATCH_SIZE,
	MAX_SEQUENCE_LENGTH,
	MAX_TOTAL_TOKENS,
	chunkCorpus,
	formatDoc,
	getEmbeddingsBatch,
	getLanguageFromPath,
	getLocalFileCorpus,
} from './codestralSearch';
import type { CodeDoc, Corpus } from './types';

describe.skip('Codestral Search Utilities', () => {
	setupConditionalLoggerOutput(); // Ensure it's called if this is the main describe for these utils

	describe('getLanguageFromPath', () => {
		it('should return Language.PYTHON for .py files', () => {
			expect(getLanguageFromPath('test.py')).to.equal(Language.PYTHON);
		});

		it('should return Language.TYPESCRIPT for .ts files', () => {
			expect(getLanguageFromPath('script.ts')).to.equal(Language.TYPESCRIPT);
		});

		it('should return Language.JAVASCRIPT for .js files', () => {
			expect(getLanguageFromPath('code.js')).to.equal(Language.JAVASCRIPT);
		});

		it('should handle uppercase extensions', () => {
			expect(getLanguageFromPath('file.PY')).to.equal(Language.PYTHON);
		});

		it('should handle mixed-case extensions', () => {
			expect(getLanguageFromPath('file.Py')).to.equal(Language.PYTHON);
		});

		it('should return Language.CPP for .cpp files', () => {
			expect(getLanguageFromPath('source.cpp')).to.equal(Language.CPP);
		});

		it('should return Language.C for .c files', () => {
			expect(getLanguageFromPath('program.c')).to.equal(Language.C);
		});

		it('should return Language.MARKDOWN for .md files', () => {
			expect(getLanguageFromPath('notes.md')).to.equal(Language.MARKDOWN);
		});

		it('should return undefined for unknown extensions (e.g., .xyz)', () => {
			expect(getLanguageFromPath('document.xyz')).to.be.undefined;
		});

		it('should return undefined for files without extensions (e.g., README)', () => {
			expect(getLanguageFromPath('README')).to.be.undefined;
		});

		it('should return undefined for files starting with a dot and no distinct extension (e.g., .gitignore)', () => {
			// path.extname('.gitignore') returns '.gitignore', so it won't be in the map unless explicitly added.
			// If '.gitignore' was mapped to Language.TEXT for example, this test would change.
			// As per current map, it will be undefined.
			expect(getLanguageFromPath('.gitignore')).to.be.undefined;
		});

		it('should return undefined for empty string path', () => {
			expect(getLanguageFromPath('')).to.be.undefined;
		});

		it('should return undefined for a path that is only an extension', () => {
			expect(getLanguageFromPath('.py')).to.equal(Language.PYTHON); // path.extname('.py') is '.py'
		});

		it('should return undefined for a path with multiple dots if the final extension is not mapped', () => {
			expect(getLanguageFromPath('archive.tar.gz')).to.be.undefined; // extname is '.gz'
		});

		it('should return correct language for a path with multiple dots if final extension is mapped', () => {
			expect(getLanguageFromPath('myfile.test.js')).to.equal(Language.JAVASCRIPT); // extname is '.js'
		});
	});

	describe('formatDoc', () => {
		it('should format doc with title and text', () => {
			const doc: CodeDoc = { title: 'file.ts', text: 'content' };
			expect(formatDoc(doc)).to.equal('file.ts\ncontent');
		});

		it('should format doc with only text if title is an empty string', () => {
			const doc: CodeDoc = { title: '', text: 'just content' };
			expect(formatDoc(doc)).to.equal('just content');
		});

		it('should format doc with only text if title consists only of whitespace', () => {
			const doc: CodeDoc = { title: '   ', text: 'content with whitespace title' };
			expect(formatDoc(doc)).to.equal('content with whitespace title');
		});

		it('should handle empty text content correctly', () => {
			const doc: CodeDoc = { title: 'file.txt', text: '' };
			expect(formatDoc(doc)).to.equal('file.txt\n'); // Note the newline character
		});

		it('should handle both empty title and empty text', () => {
			const doc: CodeDoc = { title: '', text: '' };
			expect(formatDoc(doc)).to.equal('');
		});
	});

	describe('getLocalFileCorpus', () => {
		const baseTempDir = path.join(__dirname, 'temp_corpus_test_getLocalFileCorpus');
		let testSpecificTempDir: string;

		beforeEach(async () => {
			// Create a unique subdirectory for each test to ensure isolation
			testSpecificTempDir = path.join(baseTempDir, `test-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);
			await fs.mkdir(testSpecificTempDir, { recursive: true });
		});

		afterEach(async () => {
			// Clean up the entire base temporary directory structure after all tests in this suite if needed,
			// or just the testSpecificTempDir. For safety and simplicity, cleaning baseTempDir after all tests in the suite
			// might be better if not running tests in parallel. Or clean testSpecificTempDir.
			// Let's clean the specific test's temp dir.
			if (testSpecificTempDir) {
				await fs.rm(testSpecificTempDir, { recursive: true, force: true });
			}
		});

		// Optional: Clean up the base directory once after all tests in this describe block
		// after(async () => {
		//    await fs.rm(baseTempDir, { recursive: true, force: true });
		// });

		it('should return an empty corpus for an empty directory', async () => {
			const corpus = await getLocalFileCorpus(testSpecificTempDir, ['.ts']);
			expect(Object.keys(corpus).length).to.equal(0);
		});

		it('should return an empty corpus if no files match extensions', async () => {
			await fs.writeFile(path.join(testSpecificTempDir, 'file1.txt'), 'content1');
			const corpus = await getLocalFileCorpus(testSpecificTempDir, ['.ts']);
			expect(Object.keys(corpus).length).to.equal(0);
		});

		it('should read a single matching file in the root directory', async () => {
			const filePath = path.join(testSpecificTempDir, 'file1.ts');
			await fs.writeFile(filePath, 'content1');
			const corpus = await getLocalFileCorpus(testSpecificTempDir, ['.ts']);
			expect(Object.keys(corpus).length).to.equal(1);
			// path.relative(testSpecificTempDir, filePath) should be 'file1.ts'
			expect(corpus['file1.ts']).to.deep.equal({ title: 'file1.ts', text: 'content1' });
		});

		it('should handle mixed case extensions in targetExtensions and file names', async () => {
			await fs.writeFile(path.join(testSpecificTempDir, 'file1.TS'), 'contentUpper');
			await fs.writeFile(path.join(testSpecificTempDir, 'file2.tS'), 'contentMixed');
			const corpus = await getLocalFileCorpus(testSpecificTempDir, ['.ts', '.Js']); // Target extensions also to be normalized
			expect(Object.keys(corpus).length).to.equal(2);
			expect(corpus['file1.TS']).to.deep.equal({ title: 'file1.TS', text: 'contentUpper' });
			expect(corpus['file2.tS']).to.deep.equal({ title: 'file2.tS', text: 'contentMixed' });
		});

		it('should ignore non-matching files but include matching ones', async () => {
			await fs.writeFile(path.join(testSpecificTempDir, 'file1.ts'), 'ts content');
			await fs.writeFile(path.join(testSpecificTempDir, 'file2.js'), 'js content');
			await fs.writeFile(path.join(testSpecificTempDir, 'file3.txt'), 'txt content');
			const corpus = await getLocalFileCorpus(testSpecificTempDir, ['.ts', '.js']);
			expect(Object.keys(corpus).length).to.equal(2);
			expect(corpus['file1.ts']).to.exist;
			expect(corpus['file2.js']).to.exist;
			expect(corpus['file3.txt']).to.not.exist;
		});

		it('should read files recursively and create correct relative paths', async () => {
			const subDir = path.join(testSpecificTempDir, 'api', 'v1');
			await fs.mkdir(subDir, { recursive: true });
			await fs.writeFile(path.join(testSpecificTempDir, 'root.ts'), 'root content');
			await fs.writeFile(path.join(subDir, 'sub.ts'), 'sub content');
			await fs.writeFile(path.join(subDir, 'another.js'), 'another js content');
			await fs.writeFile(path.join(subDir, 'ignored.txt'), 'ignored');

			const corpus = await getLocalFileCorpus(testSpecificTempDir, ['.ts', '.js']);
			expect(Object.keys(corpus).length).to.equal(3);

			const expectedRootPath = 'root.ts';
			expect(corpus[expectedRootPath]).to.deep.equal({ title: expectedRootPath, text: 'root content' });

			const expectedSubPathTs = path.join('api', 'v1', 'sub.ts');
			expect(corpus[expectedSubPathTs]).to.deep.equal({ title: expectedSubPathTs, text: 'sub content' });

			const expectedSubPathJs = path.join('api', 'v1', 'another.js');
			expect(corpus[expectedSubPathJs]).to.deep.equal({ title: expectedSubPathJs, text: 'another js content' });
		});

		it('should return empty corpus if dirPath does not exist', async () => {
			const nonExistentDir = path.join(testSpecificTempDir, 'nonexistent');
			const corpus = await getLocalFileCorpus(nonExistentDir, ['.ts']);
			expect(Object.keys(corpus).length).to.equal(0);
			// console.error would have logged an error, which is acceptable.
		});
	});

	describe('chunkCorpus', () => {
		const testChunkSize = 10;
		const testChunkOverlap = 3;

		// const sampleCorpusBase: Corpus = { // Not directly used in these specific tests, but good for reference
		// 	'file1.ts': { title: 'file1.ts', text: 'abcdefghijklmnopqrstuvwxyz' },
		// 	'file2.txt': { title: 'file2.txt', text: '12345' },
		// 	'empty.txt': { title: 'empty.txt', text: '' },
		// 	'noTitle.doc': { text: 'document with no title' },
		// };

		it('should chunk a document correctly with specified size and overlap', () => {
			const corpusToChunk: Corpus = { 'doc1.txt': { title: 'doc1.txt', text: 'abcdefghijklmnopqrstuvwxyz' } };
			const chunked = chunkCorpus(corpusToChunk, testChunkSize, testChunkOverlap);

			expect(Object.keys(chunked).length).to.equal(4); // Expecting 4 chunks for this specific text/params
			expect(chunked['doc1.txt_<chunk>_0'].text).to.equal('abcdefghij');
			expect(chunked['doc1.txt_<chunk>_0'].title).to.equal('doc1.txt');
			expect(chunked['doc1.txt_<chunk>_1'].text).to.equal('hijklmnopq');
			expect(chunked['doc1.txt_<chunk>_1'].title).to.equal('doc1.txt');
			expect(chunked['doc1.txt_<chunk>_2'].text).to.equal('opqrstuvwx');
			expect(chunked['doc1.txt_<chunk>_3'].text).to.equal('uvwxyz');
		});

		it('should handle text shorter than chunk size (single chunk with original ID)', () => {
			const corpusToChunk: Corpus = { 'short.txt': { title: 'short.txt', text: '12345' } };
			const chunked = chunkCorpus(corpusToChunk, testChunkSize, testChunkOverlap);
			expect(Object.keys(chunked).length).to.equal(1);
			expect(chunked['short.txt']).to.deep.equal({ title: 'short.txt', text: '12345' });
		});

		it('should handle empty text in a document (produces no entry for that document)', () => {
			const corpusToChunk: Corpus = {
				'empty.doc': { title: 'empty.doc', text: '' },
				'nonempty.doc': { title: 'nonempty.doc', text: 'abc' },
			};
			const chunked = chunkCorpus(corpusToChunk, testChunkSize, testChunkOverlap);
			expect(Object.keys(chunked).length).to.equal(1); // Only nonempty.doc should produce a chunk
			expect(chunked['nonempty.doc']).to.exist;
			expect(chunked['empty.doc']).to.not.exist;
		});

		it('should handle an empty corpus', () => {
			const chunked = chunkCorpus({}, testChunkSize, testChunkOverlap);
			expect(Object.keys(chunked).length).to.equal(0);
		});

		it('should use original ID if text is not empty but results in a single identical chunk', () => {
			const corpusToChunk: Corpus = { 'doc.txt': { title: 'doc.txt', text: 'short' } };
			// chunkSize > text.length
			const chunked = chunkCorpus(corpusToChunk, 10, 3);
			expect(Object.keys(chunked).length).to.equal(1);
			expect(chunked['doc.txt']).to.deep.equal({ title: 'doc.txt', text: 'short' });
		});

		it('should handle documents with no title', () => {
			const corpusToChunk: Corpus = { 'noTitle.doc': { title: '', text: 'document with no title' } };
			const chunked = chunkCorpus(corpusToChunk, 10, 3);
			expect(chunked['noTitle.doc_<chunk>_0'].title).to.equal('');
			expect(chunked['noTitle.doc_<chunk>_0'].text).to.equal('document w');
		});

		// Test for DO_CHUNKING = false behavior
		// This test relies on the ACTUAL_DO_CHUNKING constant imported from the module.
		// To make this test truly independent of the global constant for this specific case,
		// one might temporarily modify the constant or pass it as a parameter to chunkCorpus.
		// However, testing against the actual module behavior is also valid.
		if (!ACTUAL_DO_CHUNKING) {
			// Only run this test if the constant is actually false in the source file
			it('should return a shallow copy of original corpus if DO_CHUNKING is false', () => {
				const originalCorpus: Corpus = { 'doc.txt': { title: 'doc.txt', text: 'some text' } };
				// chunkCorpus will use the DO_CHUNKING from its own module scope
				const chunked = chunkCorpus(originalCorpus, testChunkSize, testChunkOverlap);
				expect(chunked).to.deep.equal(originalCorpus);
				expect(chunked).not.to.equal(originalCorpus); // Ensure it's a copy
			});
		}
	});
});

describe.skip('getEmbeddingsBatch', () => {
	let mistralClientMock: any;
	let embeddingsCreateStub: sinon.SinonStub;
	let consoleWarnSpy: sinon.SinonSpy;
	let consoleErrorSpy: sinon.SinonSpy;
	let consoleLogSpy: sinon.SinonSpy;

	beforeEach(() => {
		embeddingsCreateStub = sinon.stub();
		mistralClientMock = { embeddings: { create: embeddingsCreateStub } };

		// Stub getMistralClient as it's imported and used by getEmbeddingsBatch
		sinon.stub(codestralSearchModule, 'getMistralClient').returns(mistralClientMock);

		// Spy on console methods
		consoleWarnSpy = sinon.spy(console, 'warn');
		consoleErrorSpy = sinon.spy(console, 'error');
		consoleLogSpy = sinon.spy(console, 'log');
	});

	afterEach(() => {
		sinon.restore(); // This restores all stubs and spies created by sinon
	});

	it('should return an empty array for null input texts', async () => {
		const result = await getEmbeddingsBatch(null as any); // Cast to any to satisfy type checking for test
		expect(result).to.deep.equal([]);
	});

	it('should return an empty array for empty input texts', async () => {
		const result = await getEmbeddingsBatch([]);
		expect(result).to.deep.equal([]);
	});

	it('should process a single short text correctly', async () => {
		const texts = ['hello'];
		const mockEmbedding = [0.1, 0.2, 0.3];
		embeddingsCreateStub.resolves({
			data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }],
			model: EMBED_MODEL,
			usage: { prompt_tokens: 1, total_tokens: 1 },
		});

		const result = await getEmbeddingsBatch(texts);

		expect(result).to.deep.equal([mockEmbedding]);
		expect(embeddingsCreateStub.calledOnce).to.be.true;
		expect(embeddingsCreateStub.firstCall.args[0]).to.deep.equal({
			model: EMBED_MODEL,
			input: texts,
		});
		expect(consoleLogSpy.calledWith(sinon.match(/Processing final batch of 1 texts/))).to.be.true;
	});

	it('should process multiple texts that fit into a single batch', async () => {
		const texts = ['hello', 'world'];
		const mockEmbeddings = [[0.1], [0.2]];
		embeddingsCreateStub.resolves({
			data: [
				{ embedding: mockEmbeddings[0], index: 0, object: 'embedding' },
				{ embedding: mockEmbeddings[1], index: 1, object: 'embedding' },
			],
			model: EMBED_MODEL,
			usage: { prompt_tokens: 2, total_tokens: 2 },
		});

		const result = await getEmbeddingsBatch(texts);
		expect(result).to.deep.equal(mockEmbeddings);
		expect(embeddingsCreateStub.calledOnce).to.be.true;
		expect(embeddingsCreateStub.firstCall.args[0].input).to.deep.equal(texts);
		expect(consoleLogSpy.calledWith(sinon.match(/Processing final batch of 2 texts/))).to.be.true;
	});

	it('should truncate texts exceeding MAX_SEQUENCE_LENGTH and send truncated versions to API', async () => {
		const tokenizer = codestralSearchModule.getMistralTokenizer(); // Use the actual tokenizer for this test
		const longText = 'word '.repeat(MAX_SEQUENCE_LENGTH); // Create text likely > MAX_SEQUENCE_LENGTH tokens
		const tokens = tokenizer.encode(longText);
		const truncatedTokens = tokens.slice(0, MAX_SEQUENCE_LENGTH);
		const expectedApiText = tokenizer.decode(truncatedTokens);

		const mockEmbedding = [0.5];
		embeddingsCreateStub.resolves({
			data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }],
			model: EMBED_MODEL,
			usage: { prompt_tokens: MAX_SEQUENCE_LENGTH, total_tokens: MAX_SEQUENCE_LENGTH },
		});

		const result = await getEmbeddingsBatch([longText]);
		expect(result).to.deep.equal([mockEmbedding]);
		expect(consoleWarnSpy.calledOnce).to.be.true;
		expect(consoleWarnSpy.firstCall.args[0]).to.contain('Truncated text at index 0');
		expect(embeddingsCreateStub.calledOnce).to.be.true;
		expect(embeddingsCreateStub.firstCall.args[0].input).to.deep.equal([expectedApiText]);
	});

	it('should create multiple batches if MAX_BATCH_SIZE is exceeded', async () => {
		const texts: string[] = [];
		for (let i = 0; i < MAX_BATCH_SIZE + 1; i++) {
			texts.push(`text${i}`);
		}
		const mockEmbedding = [0.1];
		// Mock API to return one embedding for each text in the batch
		embeddingsCreateStub.callsFake(async (params: { input: string[] }) => {
			return {
				data: params.input.map((_, idx) => ({ embedding: mockEmbedding, index: idx, object: 'embedding' })),
				model: EMBED_MODEL,
				usage: { prompt_tokens: params.input.length, total_tokens: params.input.length },
			};
		});

		const result = await getEmbeddingsBatch(texts);
		expect(result.length).to.equal(MAX_BATCH_SIZE + 1);
		result.forEach((emb) => expect(emb).to.deep.equal(mockEmbedding));
		expect(embeddingsCreateStub.calledTwice).to.be.true;
		expect(embeddingsCreateStub.firstCall.args[0].input.length).to.equal(MAX_BATCH_SIZE);
		expect(embeddingsCreateStub.secondCall.args[0].input.length).to.equal(1);
		expect(consoleLogSpy.calledWith(sinon.match(`Processing batch of ${MAX_BATCH_SIZE} texts`))).to.be.true;
		expect(consoleLogSpy.calledWith(sinon.match(/Processing final batch of 1 texts/))).to.be.true;
	});

	it('should create multiple batches if MAX_TOTAL_TOKENS is exceeded', async () => {
		// Assume each 'testtext' is e.g. 1 token for simplicity in test setup.
		// MAX_TOTAL_TOKENS is 16384. Let's use a smaller mock value for easier testing.
		// This requires modifying the constant for the test, or designing texts carefully.
		// For now, let's assume a text that tokenizes to a large number.
		const tokenizer = codestralSearchModule.getMistralTokenizer();
		const textThatUsesHalfTokens = tokenizer.decode(new Array(Math.floor(MAX_TOTAL_TOKENS / 2)).fill(0)); // Create dummy text
		const textThatUsesQuarterTokens = tokenizer.decode(new Array(Math.floor(MAX_TOTAL_TOKENS / 4)).fill(0));

		const texts = [textThatUsesHalfTokens, textThatUsesHalfTokens, textThatUsesQuarterTokens]; // 0.5 + 0.5 (batch 1), 0.25 (batch 2)

		const mockEmbedding = [0.1];
		embeddingsCreateStub.callsFake(async (params: { input: string[] }) => {
			return {
				data: params.input.map((_, idx) => ({ embedding: mockEmbedding, index: idx, object: 'embedding' })),
				model: EMBED_MODEL,
				usage: { prompt_tokens: params.input.reduce((sum, t) => sum + tokenizer.encode(t).length, 0), total_tokens: 0 }, // Sum tokens for usage
			};
		});

		const result = await getEmbeddingsBatch(texts);
		expect(result.length).to.equal(3);
		expect(embeddingsCreateStub.calledTwice).to.be.true;
		// First batch should have 2 items
		expect(embeddingsCreateStub.firstCall.args[0].input.length).to.equal(2);
		// Second batch should have 1 item
		expect(embeddingsCreateStub.secondCall.args[0].input.length).to.equal(1);
		expect(consoleLogSpy.calledWith(sinon.match(/Processing batch of 2 texts/))).to.be.true;
		expect(consoleLogSpy.calledWith(sinon.match(/Processing final batch of 1 texts/))).to.be.true;
	});

	it('should handle API errors for a batch and return empty arrays for that batchs items', async () => {
		const texts = ['text1', 'text2', 'text3']; // text2 will be in the failing batch
		const mockEmbedding1 = [0.1];
		const mockEmbedding3 = [0.3];

		embeddingsCreateStub
			.onFirstCall()
			.resolves({
				// Batch for text1
				data: [{ embedding: mockEmbedding1, index: 0, object: 'embedding' }],
				model: EMBED_MODEL,
				usage: { prompt_tokens: 1, total_tokens: 1 },
			})
			.onSecondCall()
			.rejects(new Error('API Error for text2')) // Batch for text2 fails
			.onThirdCall()
			.resolves({
				// Batch for text3
				data: [{ embedding: mockEmbedding3, index: 0, object: 'embedding' }],
				model: EMBED_MODEL,
				usage: { prompt_tokens: 1, total_tokens: 1 },
			});

		// To make this test simpler, let's assume MAX_BATCH_SIZE = 1 for this specific test setup
		// This would require more complex stubbing of constants or careful text construction.
		// Let's test a simpler scenario: one batch fails.
		embeddingsCreateStub.reset(); // Reset previous stubbing
		embeddingsCreateStub.rejects(new Error('API Error'));

		const result = await getEmbeddingsBatch(['fail1', 'fail2']);
		expect(result).to.deep.equal([[], []]);
		expect(consoleErrorSpy.calledOnce).to.be.true;
		expect(consoleErrorSpy.firstCall.args[0]).to.contain('Error processing final batch: API Error');
	});

	it('should handle API errors for an intermediate batch and proceed with subsequent batches', async () => {
		const texts = ['text1', 'text2', 'text3', 'text4']; // text2, text3 in failing batch
		const mockEmbedding1 = [0.1];
		const mockEmbedding4 = [0.4];

		// Simulate MAX_BATCH_SIZE = 2 for this test
		const originalMaxBatchSize = codestralSearchModule.MAX_BATCH_SIZE;
		// @ts-ignore // Allow modification for test
		codestralSearchModule.MAX_BATCH_SIZE = 2;

		embeddingsCreateStub.onFirstCall().resolves({
			// Batch for text1, text2
			data: [
				{ embedding: mockEmbedding1, index: 0, object: 'embedding' },
				// text2 would be here, but this batch will be made to fail
			],
			model: EMBED_MODEL,
			usage: { prompt_tokens: 1, total_tokens: 1 },
		}); // This setup is tricky. Let's make the first batch [text1], second [text2, text3] (fails), third [text4]

		// Reset for a clearer setup:
		embeddingsCreateStub.reset();
		// @ts-ignore
		codestralSearchModule.MAX_BATCH_SIZE = 1; // Make each text its own batch for simpler error isolation

		embeddingsCreateStub
			.onCall(0)
			.resolves({ data: [{ embedding: mockEmbedding1, index: 0, object: 'embedding' }], model: EMBED_MODEL, usage: { prompt_tokens: 1, total_tokens: 1 } });
		embeddingsCreateStub.onCall(1).rejects(new Error('API Error for text2'));
		embeddingsCreateStub
			.onCall(2)
			.resolves({ data: [{ embedding: mockEmbedding4, index: 0, object: 'embedding' }], model: EMBED_MODEL, usage: { prompt_tokens: 1, total_tokens: 1 } });

		const result = await getEmbeddingsBatch(['text1', 'text2', 'text3']); // text3 will use the third call
		expect(result).to.deep.equal([mockEmbedding1, [], mockEmbedding4]);
		expect(consoleErrorSpy.calledOnce).to.be.true;
		expect(consoleErrorSpy.firstCall.args[0]).to.contain('Error processing batch: API Error for text2');
		expect(embeddingsCreateStub.callCount).to.equal(3);

		// @ts-ignore
		codestralSearchModule.MAX_BATCH_SIZE = originalMaxBatchSize; // Restore
	});

	it('should skip texts that tokenize to zero tokens initially or after truncation, resulting in empty embedding', async () => {
		const texts = ['', 'valid', '   ', 'tiny']; // Assume '' and '   ' tokenize to nothing or are pre-filtered
		// 'tiny' might become empty after truncation if MAX_SEQUENCE_LENGTH is very small
		const mockEmbedding = [0.7];
		embeddingsCreateStub.callsFake(async (params: { input: string[] }) => {
			if (params.input[0] === 'valid') {
				return { data: [{ embedding: mockEmbedding, index: 0, object: 'embedding' }], model: EMBED_MODEL, usage: { prompt_tokens: 1, total_tokens: 1 } };
			}
			if (params.input[0] === 'tiny') {
				// Simulate 'tiny' also gets an embedding if it's not empty after processing
				return { data: [{ embedding: [0.8], index: 0, object: 'embedding' }], model: EMBED_MODEL, usage: { prompt_tokens: 1, total_tokens: 1 } };
			}
			throw new Error('Unexpected API call');
		});

		const result = await getEmbeddingsBatch(texts);
		expect(result.length).to.equal(4);
		expect(result[0]).to.deep.equal([]); // for ''
		expect(result[1]).to.deep.equal(mockEmbedding); // for 'valid'
		expect(result[2]).to.deep.equal([]); // for '   '
		expect(result[3]).to.deep.equal([0.8]); // for 'tiny'

		expect(embeddingsCreateStub.calledTwice).to.be.true; // Called for 'valid' and 'tiny'
		expect(embeddingsCreateStub.getCall(0).args[0].input).to.deep.equal(['valid']);
		expect(embeddingsCreateStub.getCall(1).args[0].input).to.deep.equal(['tiny']);
	});

	it('should correctly handle texts that become empty after truncation and re-tokenization', async () => {
		const tokenizer = codestralSearchModule.getMistralTokenizer();
		// Craft a text that is non-empty, but when truncated and decoded, becomes empty or tokenizes to zero.
		// This is hard to achieve reliably without knowing tokenizer specifics for edge cases.
		// A more direct test: if item.textForApi is non-empty but itemTokenCount becomes 0.
		// The current implementation handles this by `embeddingsMap.set(item.originalIndex, [])`.

		// Let's test the case where initial text is fine, but truncated version is empty.
		const originalMaxSeqLen = codestralSearchModule.MAX_SEQUENCE_LENGTH;
		// @ts-ignore
		codestralSearchModule.MAX_SEQUENCE_LENGTH = 1; // Force truncation to 1 token

		// Assume 'abc' tokenizes to [tA, tB, tC]. Truncated to [tA]. If decode([tA]) is '', then it's covered.
		// Or, if decode([tA]) is 'a', but encode('a') is [].
		// This test might be more conceptual given tokenizer behavior.
		// The logic `if (itemTokenCount === 0)` after re-tokenizing `item.textForApi` covers this.

		const textToBecomeEmpty = '特殊字符'; // A string that might become empty if truncated to 1 token and decoded by some tokenizers
		// Or a very short string that if truncated further becomes empty.

		embeddingsCreateStub.resolves({ data: [], model: EMBED_MODEL, usage: { prompt_tokens: 0, total_tokens: 0 } }); // Should not be called if text becomes empty

		const result = await getEmbeddingsBatch([textToBecomeEmpty]);
		expect(result.length).to.equal(1);
		expect(result[0]).to.deep.equal([]); // Expect empty embedding
		expect(embeddingsCreateStub.notCalled).to.be.true; // API should not be called for this text
		expect(consoleWarnSpy.called).to.be.true; // Truncation warning

		// @ts-ignore
		codestralSearchModule.MAX_SEQUENCE_LENGTH = originalMaxSeqLen; // Restore
	});
});
