import { expect } from 'chai';
import * as sinon from 'sinon';
import { logger } from '#o11y/logger';
import { setupConditionalLoggerOutput } from '#test/testUtils';
// Import parseEditResponse instead of findOriginalUpdateBlocks
import { parseEditResponse } from './editBlockParser';

// To test the unexported findFilenameFromPrecedingLines, you might need to export it or use a special test setup.
// Or, as done here, its behavior is tested via the public parseEditResponse when using the 'diff' format.
// If direct testing of findFilenameFromPrecedingLines is desired, it should be exported from editBlockParser.ts.
// For this refactor, we'll assume indirect testing is sufficient.

describe('parseEditResponse', () => {
	setupConditionalLoggerOutput();

	const SEARCH_MARKER = '<<<<<<< SEARCH';
	const DIVIDER_MARKER = '=======';
	const REPLACE_MARKER = '>>>>>>> REPLACE';
	const FENCE = '```';
	const defaultFencePair: [string, string] = [FENCE, FENCE];

	// Tests for findFilenameFromPrecedingLines (logic test via parseEditResponse 'diff' format)
	describe('findFilenameFromPrecedingLines (logic test via "diff" format)', () => {
		// Helper to simulate calling the filename logic as it's used by parsePathPrecedingSearchReplaceBlocks
		const testFindFilenameViaDiffParser = (content: string) => {
			const response = `${content}${'\n'}${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n`;
			// Use 'diff' format as parsePathPrecedingSearchReplaceBlocks is used for it
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			return edits.length > 0 ? edits[0].filePath : undefined;
		};

		it('should find filename on immediate preceding line', () => {
			const content = 'path/to/file.ts';
			expect(testFindFilenameViaDiffParser(content)).to.equal('path/to/file.ts');
		});

		it('should find filename in ```lang filename``` format', () => {
			const content = '```typescript path/to/file.ts';
			expect(testFindFilenameViaDiffParser(content)).to.equal('path/to/file.ts');
		});

		it('should find filename among last 3 lines, preferring closest', () => {
			const content = 'old_file.txt\n```typescript path/to/file.ts';
			expect(testFindFilenameViaDiffParser(content)).to.equal('path/to/file.ts');
		});

		it('should return undefined if no filename found in relevant lines (preceding SEARCH)', () => {
			// This test needs to ensure that if findFilenameFromPrecedingLines returns undefined,
			// the block is skipped, which means `edits` would be empty or the filePath would be from a previous block.
			// For a single block with no filename, edits should be empty.
			const response = `\`\`\`typescript\n${FENCE}\nother text\n${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n`;
			const loggerSpy = logger.warn as sinon.SinonSpy;
			const initialCallCount = loggerSpy.callCount;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits.length).to.equal(0); // No filename, so block should be skipped
			expect(loggerSpy.callCount).to.be.greaterThan(initialCallCount); // Warning logged
		});

		it('should handle filename on the same line as fence but before it', () => {
			const content = 'path/to/file.ts ```typescript';
			expect(testFindFilenameViaDiffParser(content)).to.equal('path/to/file.ts');
		});
	});

	describe('parsing with "diff" format', () => {
		afterEach(() => {
			sinon.restore();
		});

		it('should parse a single valid block', () => {
			const response = `path/to/file.ts\n${SEARCH_MARKER}\noriginal content\n${DIVIDER_MARKER}\nupdated content\n${REPLACE_MARKER}\n`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits).to.deep.equal([{ filePath: 'path/to/file.ts', originalText: 'original content\n', updatedText: 'updated content\n' }]);
		});

		it('should parse multiple blocks and use sticky filename', () => {
			const response = `file1.ts\n${SEARCH_MARKER}\norig1\n${DIVIDER_MARKER}\nupd1\n${REPLACE_MARKER}\n${SEARCH_MARKER}\norig2\n${DIVIDER_MARKER}\nupd2\n${REPLACE_MARKER}\n`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits).to.deep.equal([
				{ filePath: 'file1.ts', originalText: 'orig1\n', updatedText: 'upd1\n' },
				{ filePath: 'file1.ts', originalText: 'orig2\n', updatedText: 'upd2\n' },
			]);
		});

		it('should handle block with empty original text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\n${DIVIDER_MARKER}\nnew stuff\n${REPLACE_MARKER}\n`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('');
			expect(edits[0].updatedText).to.equal('new stuff\n');
		});

		it('should handle block with empty updated text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\ndelete this\n${DIVIDER_MARKER}\n${REPLACE_MARKER}\n`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('delete this\n');
			expect(edits[0].updatedText).to.equal('');
		});

		it('should skip malformed block (missing divider) and log warning', () => {
			const response = `file.ts\n${SEARCH_MARKER}\noriginal\n${REPLACE_MARKER}\n`;
			const loggerSpy = logger.warn as sinon.SinonSpy;
			const initialCallCount = loggerSpy.callCount;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits).to.deep.equal([]);
			expect(loggerSpy.callCount).to.be.greaterThan(initialCallCount);
		});

		it('should handle filename in ```lang filename``` preceding SEARCH', () => {
			const response = `\`\`\`typescript file.ts\n${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('file.ts');
		});

		it('should correctly handle newlines in original and updated text', () => {
			const response = `file.ts\n${SEARCH_MARKER}\nline1\nline2\n${DIVIDER_MARKER}\nnew1\nnew2\n${REPLACE_MARKER}\n`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('line1\nline2\n');
			expect(edits[0].updatedText).to.equal('new1\nnew2\n');
		});

		it('should return empty array for response with no valid blocks', () => {
			const response = 'Just some random text without markers.';
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits).to.deep.equal([]);
		});

		it('should handle content before first block, and after last block', () => {
			const response = `Some intro text.\npath/to/file.ts\n${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\nSome concluding text.`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('path/to/file.ts');
		});

		it('should handle filename without preceding newline correctly', () => {
			const response = `file.ts${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('file.ts');
		});

		it('should handle multiple files correctly', () => {
			const response = `fileA.md\n${SEARCH_MARKER}\norigA\n${DIVIDER_MARKER}\nupdA\n${REPLACE_MARKER}\nfileB.txt\n${SEARCH_MARKER}\norigB\n${DIVIDER_MARKER}\nupdB\n${REPLACE_MARKER}\n`;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits).to.deep.equal([
				{ filePath: 'fileA.md', originalText: 'origA\n', updatedText: 'updA\n' },
				{ filePath: 'fileB.txt', originalText: 'origB\n', updatedText: 'updB\n' },
			]);
		});

		it('should parse LLM response with filename, then fenced S/R block (format="diff")', () => {
			const llmResponse = `Okay, I will add the Third Party Security Vendor IP addresses to the \`locals\` block and then add a new security rule to the \`firewall-config\` module in \`infra/firewall_rules.tf\`.

Here are the *SEARCH/REPLACE* blocks:

infra/firewall_rules.tf
\`\`\`tf
<<<<<<< SEARCH
  ]
  default_allow_all = false
}

module "firewall-config" {
=======
  ]
  default_allow_all = false

  vendor_security_scan_ips = [
    "1.1.1.1/32",
    "2.2.2.0/24",
    "3.3.3.3/32",
    "2001:db8::/32", // Example IPv6
  ]
}

module "firewall-config" {
>>>>>>> REPLACE
\`\`\`

infra/firewall_rules.tf
\`\`\`tf
<<<<<<< SEARCH
      description   = "Allow access for internal tool (SEC-123)"
      src_ip_ranges = ["10.0.0.5/32"]
    }
  }
  # Firewall rule language docs https://example.com/firewall-docs
  custom_rules = {
=======
      description   = "Allow access for internal tool (SEC-123)"
      src_ip_ranges = ["10.0.0.5/32"]
    }
    vendor_scan_access = {
      action        = "allow"
      priority      = 7 // This priority comes after existing rule with priority 6.
      description   = "Allow Third Party Security Vendor IPs for scanning (TASK-456)"
      src_ip_ranges = local.vendor_security_scan_ips
    }
  }
  # Firewall rule language docs https://example.com/firewall-docs
  custom_rules = {
>>>>>>> REPLACE
\`\`\`
`;
			const fencePair: [string, string] = ['```', '```'];
			// This format is 'diff' because the filename is outside, followed by a fence, then S/R markers.
			const edits = parseEditResponse(llmResponse, 'diff', fencePair);

			expect(edits.length).to.equal(2);

			// Verify first block
			expect(edits[0].filePath).to.equal('infra/firewall_rules.tf');
			expect(edits[0].originalText).to.equal(`  ]\n  default_allow_all = false\n}\n\nmodule "firewall-config" {\n`);
			expect(edits[0].updatedText).to.equal(
				`  ]\n  default_allow_all = false\n\n  vendor_security_scan_ips = [\n    "1.1.1.1/32",\n    "2.2.2.0/24",\n    "3.3.3.3/32",\n    "2001:db8::/32", // Example IPv6\n  ]\n}\n\nmodule "firewall-config" {\n`,
			);

			// Verify second block
			expect(edits[1].filePath).to.equal('infra/firewall_rules.tf');
			expect(edits[1].originalText).to.equal(
				`      description   = "Allow access for internal tool (SEC-123)"\n      src_ip_ranges = ["10.0.0.5/32"]\n    }\n  }\n  # Firewall rule language docs https://example.com/firewall-docs\n  custom_rules = {\n`,
			);
			expect(edits[1].updatedText).to.equal(
				`      description   = "Allow access for internal tool (SEC-123)"\n      src_ip_ranges = ["10.0.0.5/32"]\n    }\n    vendor_scan_access = {\n      action        = "allow"\n      priority      = 7 // This priority comes after existing rule with priority 6.\n      description   = "Allow Third Party Security Vendor IPs for scanning (TASK-456)"\n      src_ip_ranges = local.vendor_security_scan_ips\n    }\n  }\n  # Firewall rule language docs https://example.com/firewall-docs\n  custom_rules = {\n`,
			);
		});

		it('should parse multiple diff-fenced blocks', () => {
			const response = `${FENCE}ts\nfile1.ts\n${SEARCH_MARKER}\norig1\n${DIVIDER_MARKER}\nupd1\n${REPLACE_MARKER}\n${FENCE}\n\n${FENCE}py\nfile2.py\n${SEARCH_MARKER}\norig2\n${DIVIDER_MARKER}\nupd2\n${REPLACE_MARKER}\n${FENCE}\n`;
			const edits = parseEditResponse(response, 'diff-fenced', defaultFencePair);
			expect(edits).to.deep.equal([
				{ filePath: 'file1.ts', originalText: 'orig1\n', updatedText: 'upd1\n' },
				{ filePath: 'file2.py', originalText: 'orig2\n', updatedText: 'upd2\n' },
			]);
		});

		it('should handle diff-fenced block with empty original text', () => {
			const response = `${FENCE}txt\nfile.txt\n${SEARCH_MARKER}\n${DIVIDER_MARKER}\nnew stuff\n${REPLACE_MARKER}\n${FENCE}\n`;
			const edits = parseEditResponse(response, 'diff-fenced', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('');
			expect(edits[0].updatedText).to.equal('new stuff\n');
		});

		it('should handle diff-fenced block with empty updated text', () => {
			const response = `${FENCE}txt\nfile.txt\n${SEARCH_MARKER}\ndelete this\n${DIVIDER_MARKER}\n${REPLACE_MARKER}\n${FENCE}\n`;
			const edits = parseEditResponse(response, 'diff-fenced', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].originalText).to.equal('delete this\n');
			expect(edits[0].updatedText).to.equal('');
		});

		it('should skip malformed diff-fenced block (missing divider) and log warning', () => {
			const response = `${FENCE}ts\nfile.ts\n${SEARCH_MARKER}\noriginal\n${REPLACE_MARKER}\n${FENCE}\n`;
			const loggerSpy = logger.warn as sinon.SinonSpy;
			const initialCallCount = loggerSpy.callCount;
			const edits = parseEditResponse(response, 'diff-fenced', defaultFencePair);
			expect(edits).to.deep.equal([]);
			expect(loggerSpy.callCount).to.be.greaterThan(initialCallCount);
		});

		it('should skip diff-fenced block if filename cannot be extracted', () => {
			const response = `${FENCE}ts\n${SEARCH_MARKER}\noriginal\n${DIVIDER_MARKER}\nupdated\n${REPLACE_MARKER}\n${FENCE}\n`; // Missing filename line
			const loggerSpy = logger.warn as sinon.SinonSpy;
			const initialCallCount = loggerSpy.callCount;
			const edits = parseEditResponse(response, 'diff-fenced', defaultFencePair);
			expect(edits).to.deep.equal([]);
			expect(loggerSpy.callCount).to.be.greaterThan(initialCallCount);
		});
	});

	describe('fallback logic', () => {
		it('should use fallback parser if primary fails but markers are present', () => {
			// Simulate a response that looks like 'diff-fenced' but is parsed with 'diff' first
			const response = `${FENCE}typescript\npath/to/file.ts\n${SEARCH_MARKER}\noriginal content\n${DIVIDER_MARKER}\nupdated content\n${REPLACE_MARKER}\n${FENCE}\n`;
			// Primary parser ('diff') will fail because filename is inside fence
			// Fallback parser ('diff-fenced') should succeed
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('path/to/file.ts');
		});

		it('should use fallback parser if primary fails and markers are present (diff-fenced -> diff)', () => {
			// Simulate a response that looks like 'diff' but is parsed with 'diff-fenced' first
			const response = `path/to/file.ts\n${SEARCH_MARKER}\noriginal content\n${DIVIDER_MARKER}\nupdated content\n${REPLACE_MARKER}\n`;
			// Primary parser ('diff-fenced') will fail because filename is outside fence
			// Fallback parser ('diff') should succeed
			const edits = parseEditResponse(response, 'diff-fenced', defaultFencePair);
			expect(edits.length).to.equal(1);
			expect(edits[0].filePath).to.equal('path/to/file.ts');
		});

		it('should return empty if primary fails and no markers are present', () => {
			const response = 'Just some text.';
			const loggerSpy = logger.debug as sinon.SinonSpy;
			const initialCallCount = loggerSpy.callCount;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits).to.deep.equal([]);
			// Expect debug log indicating no markers found, skipping fallback
			expect(
				loggerSpy.calledWith(
					"No S/R markers detected in response after parsePathPrecedingSearchReplaceBlocks (primary for format 'diff') found no blocks. Skipping fallback parsers.",
				),
			).to.be.true;
			expect(loggerSpy.callCount).to.be.greaterThan(initialCallCount);
		});

		it('should return empty if both primary and fallback fail', () => {
			const response = `path/to/file.ts\n${SEARCH_MARKER}\noriginal\n${REPLACE_MARKER}\n`; // Malformed block
			const loggerSpy = logger.warn as sinon.SinonSpy;
			const initialCallCount = loggerSpy.callCount;
			const edits = parseEditResponse(response, 'diff', defaultFencePair);
			expect(edits).to.deep.equal([]);
			// Expect warnings from both parser attempts
			expect(loggerSpy.callCount).to.be.greaterThan(initialCallCount);
		});
	});
});
