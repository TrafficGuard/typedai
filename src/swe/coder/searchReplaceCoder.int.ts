import { expect } from 'chai';
import * as sinon from 'sinon';
import mockFs from 'mock-fs';
import { logger } from '#o11y/logger';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { SearchReplaceCoder } from './searchReplaceCoder';
import { FileSystemService } from '#functions/storage/fileSystemService'; // For type, and potentially for direct instantiation if needed for stub
import * as agentContextLocalStorage from '#agent/agentContextLocalStorage'; // To stub getFileSystem
import { join } from 'node:path'; // For constructing paths

const SEARCH_MARKER = '<<<<<<< SEARCH';
const DIVIDER_MARKER = '=======';
const REPLACE_MARKER = '>>>>>>> REPLACE';

describe('SearchReplaceCoder integration tests', () => {
	setupConditionalLoggerOutput(); // Handles logger stubbing

	const testRoot = '/test-repo'; // Absolute path for mock-fs

	beforeEach(() => {
		// Mock file system structure will be defined per test or describe block
		// Stub getFileSystem to return a FileSystemService instance operating on the mock FS
		// The FileSystemService needs a basePath, which should be our testRoot.
		const fssInstance = new FileSystemService(testRoot, logger); // logger is available from o11y
		sinon.stub(agentContextLocalStorage, 'getFileSystem').returns(fssInstance);
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

			const coder = new SearchReplaceCoder(testRoot, [filePath]);
			const llmResponse = `${filePath}\n${SEARCH_MARKER}\nworld\n${DIVIDER_MARKER}\nTypeScript\n${REPLACE_MARKER}\n`;

			const editedFiles = await coder.applyLlmResponse(llmResponse);
			expect(editedFiles).to.be.a('Set').that.has(filePath);
			expect(coder.reflectedMessage).to.be.null;

			const fss = agentContextLocalStorage.getFileSystem();
			const updatedContent = await fss!.readFile(join(testRoot, filePath));
			expect(updatedContent).to.equal('Hello TypeScript, this is a test.');
		});

		it('should create a new file when SEARCH block is empty', async () => {
			const newFilePath = 'new_file.txt';
			const newContent = 'This is a newly created file.';
			mockFs({
				[testRoot]: {}, // Empty root
			});

			const coder = new SearchReplaceCoder(testRoot, []);
			const llmResponse = `${newFilePath}\n${SEARCH_MARKER}\n\n${DIVIDER_MARKER}\n${newContent}\n${REPLACE_MARKER}\n`;

			const editedFiles = await coder.applyLlmResponse(llmResponse);
			expect(editedFiles).to.be.a('Set').that.has(newFilePath);
			expect(coder.reflectedMessage).to.be.null;

			const fss = agentContextLocalStorage.getFileSystem();
			const createdFileContent = await fss!.readFile(join(testRoot, newFilePath));
			expect(createdFileContent).to.equal(newContent + '\n'); // _stripQuotedWrapping adds a newline
		});

		it('should edit a file not initially in chat (implicitly added)', async () => {
			const filePath = 'other_file.txt';
			const initialContent = 'Original content here.';
			const newContentChunk = 'Modified part';
			mockFs({
				[join(testRoot, filePath)]: initialContent,
			});

			const coder = new SearchReplaceCoder(testRoot, []); // No initial files
			const llmResponse = `${filePath}\n${SEARCH_MARKER}\nOriginal content\n${DIVIDER_MARKER}\n${newContentChunk}\n${REPLACE_MARKER}\n`;

			const editedFiles = await coder.applyLlmResponse(llmResponse);
			expect(editedFiles).to.be.a('Set').that.has(filePath);
			expect(coder.reflectedMessage).to.be.null;
			expect((coder as any).absFnamesInChat).to.include(join(testRoot, filePath)); // Check if added to chat

			const fss = agentContextLocalStorage.getFileSystem();
			const updatedContent = await fss!.readFile(join(testRoot, filePath));
			expect(updatedContent).to.equal(newContentChunk + '\n');
		});
	});

	describe('Multiple Edits', () => {
		it('should apply multiple edits to the same file', async () => {
			const filePath = 'multi_edit.txt';
			const initialContent = 'Line 1: Alpha\nLine 2: Beta\nLine 3: Gamma';
			mockFs({
				[join(testRoot, filePath)]: initialContent,
			});

			const coder = new SearchReplaceCoder(testRoot, [filePath]);
			const llmResponse = `
${filePath}
${SEARCH_MARKER}
Alpha
${DIVIDER_MARKER}
Apple
${REPLACE_MARKER}

${filePath}
${SEARCH_MARKER}
Gamma
${DIVIDER_MARKER}
Grape
${REPLACE_MARKER}
`;
			const editedFiles = await coder.applyLlmResponse(llmResponse);
			expect(editedFiles).to.be.a('Set').that.has(filePath);
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

			const coder = new SearchReplaceCoder(testRoot, [fileAPath, fileBPath]);
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
			const editedFiles = await coder.applyLlmResponse(llmResponse);
			expect(editedFiles).to.be.a('Set').that.has(fileAPath).and.has(fileBPath);
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

			const coder = new SearchReplaceCoder(testRoot, [filePath]);
			const llmResponse = `${filePath}\n${SEARCH_MARKER}\nnonexistent search text\n${DIVIDER_MARKER}\nreplacement\n${REPLACE_MARKER}\n`;

			const editedFiles = await coder.applyLlmResponse(llmResponse);
			// applyLlmResponse returns null if reflectedMessage is set
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
			const coder = new SearchReplaceCoder(testRoot, [filePath]);
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
			const editedFiles = await coder.applyLlmResponse(llmResponse);
			expect(editedFiles).to.be.a('Set').that.has(filePath);
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
			const coder = new SearchReplaceCoder(testRoot, [filePath]);
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
			const editedFiles = await coder.applyLlmResponse(llmResponse);
			expect(editedFiles).to.be.a('Set').that.has(filePath);
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
			const coder = new SearchReplaceCoder(testRoot, [filePath]);

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
			const editedFiles = await coder.applyLlmResponse(llmResponse);
			expect(editedFiles).to.be.a('Set').that.has(filePath);
			expect(coder.reflectedMessage).to.be.null;

			const fss = agentContextLocalStorage.getFileSystem();
			const updatedContent = await fss!.readFile(join(testRoot, filePath));
			expect(updatedContent).to.equal('  new indented line\n  another indented line\n');
		});
	});
});
