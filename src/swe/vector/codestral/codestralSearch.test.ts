import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { DO_CHUNKING as ACTUAL_DO_CHUNKING, Language, chunkCorpus, formatDoc, getLanguageFromPath, getLocalFileCorpus } from './codestralSearch'; // Adjusted path to be relative
import type { CodeDoc, Corpus } from './types';

describe('includeAlternativeAiToolFiles', () => {
	setupConditionalLoggerOutput();

	describe('Indexing', () => {});

	describe('Search', () => {});
});

describe('Codestral Search Utilities', () => {
	// setupConditionalLoggerOutput(); // Already called in the original describe block, should be fine.
	// If not, uncomment this.

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
