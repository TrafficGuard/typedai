import { join } from 'node:path';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import * as agentContextLocalStorage from '#agent/agentContextLocalStorage';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { MockLLM } from '#llm/services/mock-llm';
import { logger } from '#o11y/logger';
import type { LLM } from '#shared/model/llm.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { ApplySearchReplace } from './applySearchReplace';
// Ensure _stripFilename is imported if _findFilenameFromPrecedingLines directly uses it from utils
import { _stripFilename } from './applySearchReplaceUtils';

const SEARCH_MARKER = '<<<<<<< SEARCH';
const DIVIDER_MARKER = '=======';
const REPLACE_MARKER = '>>>>>>> REPLACE';

describe('ApplySearchReplace', () => {
	setupConditionalLoggerOutput();
	let llm: LLM;

	describe('_findFilename', () => {
		let coder: ApplySearchReplace;
		beforeEach(() => {
			coder = new ApplySearchReplace('.');
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
		let coder: ApplySearchReplace;

		beforeEach(() => {
			coder = new ApplySearchReplace('.');
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

	describe('FileSystem end-to-end tests', () => {
		const testRoot = '/test-repo';

		beforeEach(() => {
			// Mock file system structure will be defined per test or describe block
			// Stub getFileSystem to return a FileSystemService instance operating on the mock FS
			// The FileSystemService needs a basePath, which should be our testRoot.
			const fssInstance = new FileSystemService(testRoot);
			sinon.stub(agentContextLocalStorage, 'getFileSystem').returns(fssInstance);
			llm = new MockLLM();
		});

		afterEach(() => {
			mockFs.restore();
			sinon.restore(); // Restores stubs on getFileSystem and any other sinon mocks/stubs
		});

		describe('Basic File Operations', () => {
			it('should apply a simple replacement to an existing file', async () => {
				const initialContent = 'Hello world, this is a test.';
				const filePath = 'file1.txt';
				mockFs({
					[join(testRoot, filePath)]: initialContent,
				});

				const coder = new ApplySearchReplace(testRoot, [filePath]);
				// SEARCH block now matches the entire line
				const llmResponse = `${filePath}\n${SEARCH_MARKER}\nHello world, this is a test.\n${DIVIDER_MARKER}\nHello TypeScript, this is a test.\n${REPLACE_MARKER}\n`;

				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.include(filePath);
				expect(coder.reflectedMessage).to.be.null;

				const fss = agentContextLocalStorage.getFileSystem();
				const updatedContent = await fss!.readFile(join(testRoot, filePath));
				// Expected content will have a newline due to line-based replacement logic
				expect(updatedContent).to.equal('Hello TypeScript, this is a test.\n');
			});

			it('should create a new file when SEARCH block is empty', async () => {
				const newFilePath = 'new_file.txt';
				const newContent = 'This is a newly created file.';
				mockFs({
					[testRoot]: {}, // Empty root
				});

				const coder = new ApplySearchReplace(testRoot, []);
				const llmResponse = `${newFilePath}\n${SEARCH_MARKER}\n\n${DIVIDER_MARKER}\n${newContent}\n${REPLACE_MARKER}\n`;

				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.include(newFilePath);
				expect(coder.reflectedMessage).to.be.null;

				const fss = agentContextLocalStorage.getFileSystem();
				const createdFileContent = await fss!.readFile(join(testRoot, newFilePath));
				expect(createdFileContent).to.equal(`${newContent}\n`); // _stripQuotedWrapping adds a newline
			});

			it('should edit a file not initially in chat (implicitly added)', async () => {
				const filePath = 'other_file.txt';
				const initialContent = 'Original content here.';
				const replacementContent = 'Modified part completely replaces.';
				mockFs({
					[join(testRoot, filePath)]: initialContent,
				});

				const coder = new ApplySearchReplace(testRoot, []); // No initial files
				const llmResponse = `${filePath}\n${SEARCH_MARKER}\nOriginal content here.\n${DIVIDER_MARKER}\n${replacementContent}\n${REPLACE_MARKER}\n`;

				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.include(filePath);
				expect(coder.reflectedMessage).to.be.null;
				expect((coder as any).absFnamesInChat).to.include(join(testRoot, filePath));

				const fss = agentContextLocalStorage.getFileSystem();
				const updatedContent = await fss!.readFile(join(testRoot, filePath));
				expect(updatedContent).to.equal(`${replacementContent}\n`);
			});
		});

		describe('Multiple Edits', () => {
			it('should apply multiple edits to the same file', async () => {
				const filePath = 'multi_edit.txt';
				const initialContent = 'Line 1: Alpha\nLine 2: Beta\nLine 3: Gamma';
				mockFs({
					[join(testRoot, filePath)]: initialContent,
				});

				const coder = new ApplySearchReplace(testRoot, [filePath]);
				const llmResponse = `
${filePath}
${SEARCH_MARKER}
Line 1: Alpha
${DIVIDER_MARKER}
Line 1: Apple
${REPLACE_MARKER}

${filePath}
${SEARCH_MARKER}
Line 3: Gamma
${DIVIDER_MARKER}
Line 3: Grape
${REPLACE_MARKER}
`;
				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.include(filePath);
				expect(coder.reflectedMessage).to.be.null;

				const fss = agentContextLocalStorage.getFileSystem();
				const updatedContent = await fss!.readFile(join(testRoot, filePath));
				expect(updatedContent).to.equal('Line 1: Apple\nLine 2: Beta\nLine 3: Grape\n');
			});

			it('should apply edits to multiple different files', async () => {
				const fileAPath = 'fileA.ts';
				const fileBPath = 'fileB.ts';
				const initialContentA = 'const a = 10;';
				const initialContentB = 'const b = 20;';
				mockFs({
					[join(testRoot, fileAPath)]: initialContentA,
					[join(testRoot, fileBPath)]: initialContentB,
				});

				const coder = new ApplySearchReplace(testRoot, [fileAPath, fileBPath]);
				const llmResponse = `
${fileAPath}
${SEARCH_MARKER}
const a = 10;
${DIVIDER_MARKER}
const a = 100;
${REPLACE_MARKER}

${fileBPath}
${SEARCH_MARKER}
const b = 20;
${DIVIDER_MARKER}
const b = 200;
${REPLACE_MARKER}
`;
				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.include(fileAPath);
				expect(editedFiles).to.include(fileBPath);
				expect(coder.reflectedMessage).to.be.null;

				const fss = agentContextLocalStorage.getFileSystem();
				const updatedContentA = await fss!.readFile(join(testRoot, fileAPath));
				const updatedContentB = await fss!.readFile(join(testRoot, fileBPath));
				expect(updatedContentA).to.equal('const a = 100;\n');
				expect(updatedContentB).to.equal('const b = 200;\n');
			});
		});

		describe('Failure Cases and Error Handling', () => {
			it('should not modify file and set reflectedMessage if SEARCH block not found', async () => {
				const filePath = 'fail_edit.txt';
				const initialContent = 'This content will not change.';
				mockFs({
					[join(testRoot, filePath)]: initialContent,
				});

				const coder = new ApplySearchReplace(testRoot, [filePath]);
				const llmResponse = `${filePath}\n${SEARCH_MARKER}\nnonexistent search text\n${DIVIDER_MARKER}\nreplacement\n${REPLACE_MARKER}\n`;

				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.be.null;
				expect(coder.reflectedMessage).to.be.a('string').and.contain('failed to match');

				const fss = agentContextLocalStorage.getFileSystem();
				const contentAfterAttempt = await fss!.readFile(join(testRoot, filePath));
				expect(contentAfterAttempt).to.equal(initialContent); // File should be unchanged
			});
		});

		describe('Advanced Replacement Logic (DotDotDots, Whitespace)', () => {
			it('should handle ... (dotdotdots) for elided content', async () => {
				const filePath = 'dot_test.txt';
				const initialContent = 'FunctionHeader\n  Valuable Line 1\n  Valuable Line 2\nFunctionFooter';
				mockFs({
					[join(testRoot, filePath)]: initialContent,
				});
				const coder = new ApplySearchReplace(testRoot, [filePath]);
				const llmResponse = `
${filePath}
${SEARCH_MARKER}
FunctionHeader
...
FunctionFooter
${DIVIDER_MARKER}
NewHeader
...
NewFooter
${REPLACE_MARKER}
`;
				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.include(filePath);
				expect(coder.reflectedMessage).to.be.null;

				const fss = agentContextLocalStorage.getFileSystem();
				const updatedContent = await fss!.readFile(join(testRoot, filePath));
				// Note: _prep adds a newline if missing, and _tryDotDotDots ensures pieces end with \n
				expect(updatedContent).to.equal('NewHeader\n  Valuable Line 1\n  Valuable Line 2\nNewFooter\n');
			});

			it('should handle ... (dotdotdots) for insertion', async () => {
				const filePath = 'dot_insert.txt';
				const initialContent = 'Alpha\nDelta';
				mockFs({
					[join(testRoot, filePath)]: initialContent,
				});
				const coder = new ApplySearchReplace(testRoot, [filePath]);
				const llmResponse = `
${filePath}
${SEARCH_MARKER}
Alpha
...
Delta
${DIVIDER_MARKER}
Alpha
Beta
Gamma
...
Delta
${REPLACE_MARKER}
`;
				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.include(filePath);
				expect(coder.reflectedMessage).to.be.null;

				const fss = agentContextLocalStorage.getFileSystem();
				const updatedContent = await fss!.readFile(join(testRoot, filePath));
				expect(updatedContent).to.equal('Alpha\nBeta\nGamma\nDelta\n');
			});

			it('should correctly replace content considering flexible leading whitespace', async () => {
				const filePath = 'whitespace_test.txt';
				// Initial content has 2 spaces before "indented"
				const initialContent = '  indented line\n  another indented line';
				mockFs({
					[join(testRoot, filePath)]: initialContent,
				});
				const coder = new ApplySearchReplace(testRoot, [filePath]);

				// SEARCH block has no leading whitespace for "indented line"
				// REPLACE block also has no leading whitespace for "new indented line"
				// The _replacePartWithMissingLeadingWhitespace should match "  indented line"
				// and apply the same "  " prefix to "new indented line".
				const llmResponse = `
${filePath}
${SEARCH_MARKER}
indented line
${DIVIDER_MARKER}
new indented line
${REPLACE_MARKER}
`;
				const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
				expect(editedFiles).to.include(filePath);
				expect(coder.reflectedMessage).to.be.null;

				const fss = agentContextLocalStorage.getFileSystem();
				const updatedContent = await fss!.readFile(join(testRoot, filePath));
				expect(updatedContent).to.equal('  new indented line\n  another indented line\n');
			});
		});
	});

	// Top level without mock-fs
	describe('More examples', () => {
		const componentPath = 'src/swe/coder/test/test.ts';
		const htmlPath = 'src/swe/coder/test/test.html';

		afterEach(async () => {
			try {
				const vcs = new FileSystemService().getVcs();
				await vcs.revertFile(componentPath);
				await vcs.revertFile(htmlPath);
			} catch (e) {
				logger.warn(e, 'Error reverting test files');
			}
		});

		it('Edit an Angular component', async () => {
			const filePaths = [componentPath, htmlPath];

			const coder = new ApplySearchReplace('.', filePaths);
			const llmResponse = `
${htmlPath}
${SEARCH_MARKER}
        </button>
        <button class="ml-0.5"
                mat-icon-button
                (click)="toggleThinking()"
                [disabled]="!llmHasThinkingLevels"
                [matTooltip]="'Thinking level: ' + thinkingLevel.toUpperCase() + '. Click to cycle through thinking levels'">
            <mat-icon [svgIcon]="thinkingIcon" [ngClass]="{'text-primary': sendOnEnter}"></mat-icon>
        </button>
    </div>
${DIVIDER_MARKER}
        </button>
        <button class="ml-0.5"
                mat-icon-button
                (click)="toggleThinking()"
                [disabled]="!llmHasThinkingLevels"
                [matTooltip]="'Thinking level: ' + thinkingLevel.toUpperCase() + '. Click to cycle through thinking levels'">
            <mat-icon [svgIcon]="thinkingIcon" [ngClass]="{'text-primary': sendOnEnter}"></mat-icon>
        </button>
        <button mat-icon-button matTooltip="Reformat message" (click)="reformat(message)">
			<mat-icon>markdown</mat-icon>
		</button>
    </div>
${REPLACE_MARKER}

${componentPath}
${SEARCH_MARKER}
	removeAttachment(attachmentToRemove: Attachment): void {
		this.selectedAttachments = this.selectedAttachments.filter((att) => att !== attachmentToRemove);
		this._changeDetectorRef.markForCheck();
	}
${DIVIDER_MARKER}
    removeAttachment(attachmentToRemove: Attachment): void {
        this.selectedAttachments = this.selectedAttachments.filter(
            att => att !== attachmentToRemove
        );
        this._changeDetectorRef.markForCheck();
    }

  	reformat(message: Message) {
    	// TODO: Implement markdown reformatting logic
    	console.log('Reformatting message:', message);
	} 
${REPLACE_MARKER}
`;
			const editedFiles = await coder.applyLlmResponse(llmResponse, llm);
			console.log('editedFiles:');
			console.log(editedFiles);
			expect(editedFiles).to.include(htmlPath);
			expect(editedFiles).to.include(componentPath);

			expect(coder.reflectedMessage).to.be.null;

			const fss = agentContextLocalStorage.getFileSystem();

			const content = await fss.readFilesAsXml([componentPath, htmlPath]);
			expect(content).to.include('reformat(message: Message)');
			expect(content).to.include('(click)="reformat(message)"');
		});
	});
});
