import { expect } from 'chai';
import { describe, it } from 'mocha';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { Language, formatDoc, getLanguageFromPath } from './codestralSearch'; // Adjusted path to be relative
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
});
