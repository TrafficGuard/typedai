import { expect } from 'chai';
import * as sinon from 'sinon';
import { logger } from '#o11y/logger';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { SearchReplaceCoder } from './searchReplaceCoder';
// Ensure _stripFilename is imported if _findFilenameFromPrecedingLines directly uses it from utils
import { _stripFilename } from './searchReplaceUtils';

describe('SearchReplaceCoder', () => {
	setupConditionalLoggerOutput();

	describe('_findFilename', () => {
		let coder: SearchReplaceCoder;
		beforeEach(() => {
			coder = new SearchReplaceCoder('.');
		});

		it('should find filename on immediate preceding line', () => {
			const content = 'path/to/file.ts\n';
			expect((coder as any)._findFilename(content, '```')).to.equal('path/to/file.ts');
		});

		it('should find filename in ```lang filename``` format', () => {
			const content = '```typescript path/to/file.ts\n';
			expect((coder as any)._findFilename(content, '```')).to.equal('path/to/file.ts');
		});

		it('should find filename among last 3 lines, preferring closest', () => {
			const content = 'old_file.txt\n```typescript path/to/file.ts\n';
			expect((coder as any)._findFilename(content, '```')).to.equal('path/to/file.ts');
		});

		it('should return undefined if no filename found in relevant lines', () => {
			const content = '```typescript\n```\nother text\n'; // `other text` is last line of preceding content
			expect((coder as any)._findFilename(content, '```')).to.equal(undefined);
		});

		it('should handle filename on the same line as fence but before it', () => {
			const content = 'path/to/file.ts ```typescript\n';
			expect((coder as any)._findFilename(content, '```')).to.equal('path/to/file.ts');
		});
	});

	describe('_findOriginalUpdateBlocks', () => {
		const SEARCH_MARKER = '<<<<<<< SEARCH';
		const DIVIDER_MARKER = '=======';
		const REPLACE_MARKER = '>>>>>>> REPLACE';
		let coder: SearchReplaceCoder;

		beforeEach(() => {
			coder = new SearchReplaceCoder('.');
			// setupConditionalLoggerOutput() at the top-level describe and the afterEach below
			// should handle logger stubbing and restoration.
			// No need to manually restore logger.warn here.
		});

		afterEach(() => {
			// Restore any sinon modifications if not handled by setupConditionalLoggerOutput per test
			sinon.restore();
		});


		it('should parse a single valid block', () => {
			const response = `path/to/file.ts\n${SEARCH_MARKER}\noriginal content\n${DIVIDER_MARKER}\nupdated content\n${REPLACE_MARKER}\n`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([{ filePath: 'path/to/file.ts', originalText: 'original content\n', updatedText: 'updated content\n' }]);
		});

		it('should parse multiple blocks and use sticky filename', () => {
			const response = `file1.ts\n${SEARCH_MARKER}\norig1\n${DIVIDER_MARKER}\nupd1\n${REPLACE_MARKER}\n${SEARCH_MARKER}\norig2\n${DIVIDER_MARKER}\nupd2\n${REPLACE_MARKER}\n`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([
				{ filePath: 'file1.ts', originalText: 'orig1\n', updatedText: 'upd1\n' },
				{ filePath: 'file1.ts', originalText: 'orig2\n', updatedText: 'upd2\n' },
			]);
		});

		it('should handle block with empty original text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\n${DIVIDER_MARKER}\nnew stuff\n${REPLACE_MARKER}\n`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('');
			expect(edits[0].updatedText).to.equal('new stuff\n');
		});

		it('should handle block with empty updated text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\ndelete this\n${DIVIDER_MARKER}\n${REPLACE_MARKER}\n`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('delete this\n');
			expect(edits[0].updatedText).to.equal('');
		});

		it('should skip malformed block (missing divider) and log warning', () => {
			const response = `file.ts\n${SEARCH_MARKER}\noriginal\n${REPLACE_MARKER}\n`;
			// setupConditionalLoggerOutput stubs logger methods. We check if the stub was called.
			// No need to create a new spy if logger.warn is already a sinon stub/spy.
			const initialCallCount = (logger.warn as sinon.SinonSpy).callCount || 0;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([]);
			expect((logger.warn as sinon.SinonSpy).callCount).to.be.greaterThan(initialCallCount);
		});

		it('should handle filename in ```lang filename``` preceding SEARCH', () => {
			const response = `\`\`\`typescript file.ts\n${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('file.ts');
		});

		it('should correctly handle newlines in original and updated text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\nline1\nline2\n${DIVIDER_MARKER}\nnew1\nnew2\n${REPLACE_MARKER}\n`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('line1\nline2\n');
			expect(edits[0].updatedText).to.equal('new1\nnew2\n');
		});

		it('should return empty array for response with no valid blocks', () => {
			const response = 'Just some random text without markers.';
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([]);
		});

		it('should handle content before first block, and after last block', () => {
			const response = `Some intro text.\npath/to/file.ts\n${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\nSome concluding text.`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('path/to/file.ts');
		});

		it('should handle filename without preceding newline correctly', () => {
			const response = `file.ts${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('file.ts');
		});

		it('should handle multiple files correctly', () => {
			const response = `fileA.md\n${SEARCH_MARKER}\norigA\n${DIVIDER_MARKER}\nupdA\n${REPLACE_MARKER}\nfileB.txt\n${SEARCH_MARKER}\norigB\n${DIVIDER_MARKER}\nupdB\n${REPLACE_MARKER}\n`;
			const edits = (coder as any)._findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([
				{ filePath: 'fileA.md', originalText: 'origA\n', updatedText: 'updA\n' },
				{ filePath: 'fileB.txt', originalText: 'origB\n', updatedText: 'updB\n' },
			]);
		});
	});
});
