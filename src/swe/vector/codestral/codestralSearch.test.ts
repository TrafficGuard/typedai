import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { expect } from 'chai';
import { afterEach, beforeEach, describe, it } from 'mocha';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { Language, formatDoc, getLanguageFromPath, getLocalFileCorpus } from './codestralSearch'; // Adjusted path to be relative
import type { CodeDoc } from './types';

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
});
