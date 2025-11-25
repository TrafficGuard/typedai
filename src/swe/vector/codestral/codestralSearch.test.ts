import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import {
	DO_CHUNKING as ACTUAL_DO_CHUNKING,
	EMBED_MODEL,
	type EmbeddingBatchOptions,
	Language,
	chunkCorpus,
	formatDoc,
	getEmbeddingsBatch,
	getLanguageFromPath,
	getLocalFileCorpus,
} from './codestralSearch';
import type { CodeDoc, Corpus } from './types';

describe('Codestral Search Utilities', () => {
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

		it('should return the language when only an extension is provided', () => {
			expect(getLanguageFromPath('.py')).to.equal(Language.PYTHON);
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
			expect(chunked['doc1.txt_<chunk>_3'].text).to.equal('vwxyz');
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

describe('getEmbeddingsBatch', () => {
	let clientMock: any;
	let embeddingsCreateStub: sinon.SinonStub;
	let logger: { log: sinon.SinonSpy; warn: sinon.SinonSpy; error: sinon.SinonSpy };
	let tokenizer: { encode: (text: string) => number[]; decode: (tokens: number[]) => string };

	beforeEach(() => {
		embeddingsCreateStub = sinon.stub();
		clientMock = { embeddings: { create: embeddingsCreateStub } };
		logger = { log: sinon.spy(), warn: sinon.spy(), error: sinon.spy() } as any;
		tokenizer = {
			encode: (text: string) => (text ? Array.from(text).map((_, idx) => idx + 1) : []),
			decode: (tokens: number[]) => 'x'.repeat(tokens.length),
		};
	});

	afterEach(() => {
		sinon.restore();
	});

	const defaultOptions = (overrides: Partial<EmbeddingBatchOptions> = {}): EmbeddingBatchOptions => ({
		client: clientMock,
		tokenizer,
		logger,
		maxBatchSize: 4,
		maxTotalTokens: 50,
		maxSequenceLength: 20,
		...overrides,
	});

	it('returns an empty array when input is null or empty', async () => {
		expect(await getEmbeddingsBatch(null as any)).to.deep.equal([]);
		expect(await getEmbeddingsBatch([], defaultOptions())).to.deep.equal([]);
		expect(embeddingsCreateStub.called).to.be.false;
	});

	it('processes a single short text', async () => {
		const mockEmbedding = [0.1, 0.2, 0.3];
		embeddingsCreateStub.resolves({ data: [{ embedding: mockEmbedding }], model: EMBED_MODEL, usage: { prompt_tokens: 1, total_tokens: 1 } });

		const result = await getEmbeddingsBatch(['hello'], defaultOptions());

		expect(result).to.deep.equal([mockEmbedding]);
		expect(embeddingsCreateStub.calledOnce).to.be.true;
		expect(embeddingsCreateStub.firstCall.args[0]).to.deep.equal({ model: EMBED_MODEL, input: ['hello'] });
		expect(logger.log.calledWithMatch(/final batch of 1 texts/)).to.be.true;
	});

	it('truncates long texts and uses the truncated payload', async () => {
		const longText = 'abcdefghijklmnopqrstuvwxyz';
		const options = defaultOptions({ maxSequenceLength: 5 });
		embeddingsCreateStub.resolves({ data: [{ embedding: [0.5] }], model: EMBED_MODEL, usage: { prompt_tokens: 5, total_tokens: 5 } });

		const result = await getEmbeddingsBatch([longText], options);

		expect(result).to.deep.equal([[0.5]]);
		expect(embeddingsCreateStub.calledOnce).to.be.true;
		expect(embeddingsCreateStub.firstCall.args[0].input[0]).to.equal('xxxxx');
		expect(logger.warn.calledWithMatch(/Truncated text at index 0/)).to.be.true;
	});

	it('splits batches by maxBatchSize', async () => {
		const texts = ['a', 'b', 'c'];
		const options = defaultOptions({ maxBatchSize: 2 });
		embeddingsCreateStub.callsFake(async ({ input }: { input: string[] }) => ({
			data: input.map((_, idx) => ({ embedding: [`e${idx}`] })),
			model: EMBED_MODEL,
			usage: { prompt_tokens: input.length, total_tokens: input.length },
		}));

		const result = await getEmbeddingsBatch(texts, options);

		expect(result).to.deep.equal([['e0'], ['e1'], ['e0']]);
		expect(embeddingsCreateStub.callCount).to.equal(2);
		expect(embeddingsCreateStub.firstCall.args[0].input.length).to.equal(2);
		expect(embeddingsCreateStub.secondCall.args[0].input.length).to.equal(1);
		expect(logger.log.calledWithMatch(/Processing batch of 2 texts/)).to.be.true;
		expect(logger.log.calledWithMatch(/Processing final batch of 1 texts/)).to.be.true;
	});

	it('splits batches when total tokens exceed the limit', async () => {
		const texts = ['abc', 'defg', 'hi']; // token lengths 3,4,2
		const options = defaultOptions({ maxTotalTokens: 5 });
		embeddingsCreateStub.callsFake(async ({ input }: { input: string[] }) => ({
			data: input.map((_, idx) => ({ embedding: [`b${idx}`] })),
			model: EMBED_MODEL,
			usage: { prompt_tokens: input.length, total_tokens: input.length },
		}));

		const result = await getEmbeddingsBatch(texts, options);

		expect(result).to.deep.equal([['b0'], ['b0'], ['b0']]);
		expect(embeddingsCreateStub.callCount).to.equal(3);
		expect(logger.log.calledWithMatch(/Processing batch of 1 texts/)).to.be.true;
		expect(logger.log.calledWithMatch(/Processing final batch of 1 texts/)).to.be.true;
	});

	it('returns empty embeddings for a failed batch and continues', async () => {
		const options = defaultOptions({ maxBatchSize: 1 });
		embeddingsCreateStub.onFirstCall().rejects(new Error('fail'));
		embeddingsCreateStub.onSecondCall().resolves({ data: [{ embedding: ['ok'] }], model: EMBED_MODEL, usage: { prompt_tokens: 1, total_tokens: 1 } });

		const result = await getEmbeddingsBatch(['one', 'two'], options);

		expect(result).to.deep.equal([[], ['ok']]);
		expect(logger.error.calledWithMatch(/Error processing batch: fail/)).to.be.true;
		expect(embeddingsCreateStub.callCount).to.equal(2);
	});

	it('skips empty or whitespace entries', async () => {
		embeddingsCreateStub.resolves({ data: [{ embedding: ['live'] }], model: EMBED_MODEL, usage: { prompt_tokens: 1, total_tokens: 1 } });

		const result = await getEmbeddingsBatch(['', '  ', 'go'], defaultOptions({ maxBatchSize: 1 }));

		expect(result).to.deep.equal([[], [], ['live']]);
		expect(embeddingsCreateStub.calledOnce).to.be.true;
		expect(embeddingsCreateStub.firstCall.args[0].input).to.deep.equal(['go']);
	});
});
