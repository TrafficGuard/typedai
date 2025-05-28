import { expect } from 'chai';
import * as sinon from 'sinon';
import { logger } from '#o11y/logger';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { findOriginalUpdateBlocks } from './editBlockParser'; // Testing the new module-level function
// Import findFilenameFromPrecedingLines if you want to test it directly (it's not exported by default)
// For now, we test it indirectly via findOriginalUpdateBlocks

// To test the unexported findFilenameFromPrecedingLines, you might need to export it or use a special test setup.
// Or, as done here, its behavior is tested via the public findOriginalUpdateBlocks.
// If direct testing of findFilenameFromPrecedingLines is desired, it should be exported from editBlockParser.ts.
// For this refactor, we'll assume indirect testing is sufficient.

describe('EditBlockParser', () => {
	setupConditionalLoggerOutput();

	// Tests for findFilenameFromPrecedingLines (indirectly or directly if exported)
	// These are conceptual tests for the logic previously in EditBlockParser._findFilename
	describe('findFilenameFromPrecedingLines (logic test)', () => {
		// Helper to simulate calling the filename logic as it's used by findOriginalUpdateBlocks
		// This is a bit of a workaround. Ideally, if findFilenameFromPrecedingLines
		// needs unit testing, it should be exported.
		const testFindFilename = (content: string) => {
			const response = `${content}${'\n'}<<<<<<< SEARCH\noriginal\n=======\nupdated\n>>>>>>> REPLACE\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			return edits.length > 0 ? edits[0].filePath : undefined;
		};

		it('should find filename on immediate preceding line', () => {
			const content = 'path/to/file.ts';
			expect(testFindFilename(content)).to.equal('path/to/file.ts');
		});

		it('should find filename in ```lang filename``` format', () => {
			const content = '```typescript path/to/file.ts';
			expect(testFindFilename(content)).to.equal('path/to/file.ts');
		});

		it('should find filename among last 3 lines, preferring closest', () => {
			const content = 'old_file.txt\n```typescript path/to/file.ts';
			expect(testFindFilename(content)).to.equal('path/to/file.ts');
		});

		it('should return undefined if no filename found in relevant lines (preceding SEARCH)', () => {
			// This test needs to ensure that if findFilenameFromPrecedingLines returns undefined,
			// the block is skipped, which means `edits` would be empty or the filePath would be from a previous block.
			// For a single block with no filename, edits should be empty.
			const response = `\`\`\`typescript\n\`\`\`\nother text\n<<<<<<< SEARCH\noriginal\n=======\nupdated\n>>>>>>> REPLACE\n`;
			const loggerSpy = logger.warn as sinon.SinonSpy;
			const initialCallCount = loggerSpy.callCount;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(0); // No filename, so block should be skipped
			expect(loggerSpy.callCount).to.be.greaterThan(initialCallCount); // Warning logged
		});

		it('should handle filename on the same line as fence but before it', () => {
			const content = 'path/to/file.ts ```typescript';
			expect(testFindFilename(content)).to.equal('path/to/file.ts');
		});
	});

	describe('findOriginalUpdateBlocks', () => {
		const SEARCH_MARKER = '<<<<<<< SEARCH';
		const DIVIDER_MARKER = '=======';
		const REPLACE_MARKER = '>>>>>>> REPLACE';

		afterEach(() => {
			sinon.restore();
		});

		it('should parse a single valid block', () => {
			const response = `path/to/file.ts\n${SEARCH_MARKER}\noriginal content\n${DIVIDER_MARKER}\nupdated content\n${REPLACE_MARKER}\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([{ filePath: 'path/to/file.ts', originalText: 'original content\n', updatedText: 'updated content\n' }]);
		});

		it('should parse multiple blocks and use sticky filename', () => {
			const response = `file1.ts\n${SEARCH_MARKER}\norig1\n${DIVIDER_MARKER}\nupd1\n${REPLACE_MARKER}\n${SEARCH_MARKER}\norig2\n${DIVIDER_MARKER}\nupd2\n${REPLACE_MARKER}\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([
				{ filePath: 'file1.ts', originalText: 'orig1\n', updatedText: 'upd1\n' },
				{ filePath: 'file1.ts', originalText: 'orig2\n', updatedText: 'upd2\n' },
			]);
		});

		it('should handle block with empty original text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\n${DIVIDER_MARKER}\nnew stuff\n${REPLACE_MARKER}\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('');
			expect(edits[0].updatedText).to.equal('new stuff\n');
		});

		it('should handle block with empty updated text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\ndelete this\n${DIVIDER_MARKER}\n${REPLACE_MARKER}\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('delete this\n');
			expect(edits[0].updatedText).to.equal('');
		});

		it('should skip malformed block (missing divider) and log warning', () => {
			const response = `file.ts\n${SEARCH_MARKER}\noriginal\n${REPLACE_MARKER}\n`;
			const loggerSpy = logger.warn as sinon.SinonSpy;
			const initialCallCount = loggerSpy.callCount;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([]);
			expect(loggerSpy.callCount).to.be.greaterThan(initialCallCount);
		});

		it('should handle filename in ```lang filename``` preceding SEARCH', () => {
			const response = `\`\`\`typescript file.ts\n${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('file.ts');
		});

		it('should correctly handle newlines in original and updated text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\nline1\nline2\n${DIVIDER_MARKER}\nnew1\nnew2\n${REPLACE_MARKER}\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('line1\nline2\n');
			expect(edits[0].updatedText).to.equal('new1\nnew2\n');
		});

		it('should return empty array for response with no valid blocks', () => {
			const response = 'Just some random text without markers.';
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([]);
		});

		it('should handle content before first block, and after last block', () => {
			const response = `Some intro text.\npath/to/file.ts\n${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\nSome concluding text.`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('path/to/file.ts');
		});

		it('should handle filename without preceding newline correctly', () => {
			const response = `file.ts${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('file.ts');
		});

		it('should handle multiple files correctly', () => {
			const response = `fileA.md\n${SEARCH_MARKER}\norigA\n${DIVIDER_MARKER}\nupdA\n${REPLACE_MARKER}\nfileB.txt\n${SEARCH_MARKER}\norigB\n${DIVIDER_MARKER}\nupdB\n${REPLACE_MARKER}\n`;
			const edits = findOriginalUpdateBlocks(response, ['```', '```']);
			expect(edits).to.deep.equal([
				{ filePath: 'fileA.md', originalText: 'origA\n', updatedText: 'updA\n' },
				{ filePath: 'fileB.txt', originalText: 'origB\n', updatedText: 'updB\n' },
			]);
		});
	});
});
