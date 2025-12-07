import { expect } from 'chai';
import mock from 'mock-fs';
import sinon from 'sinon';
import * as agentContextLocalStorageModule from '#agent/agentContextUtils';
import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/files/files.model';
import type { UserContentExt } from '#shared/llm/llm.model';
import type { ProjectInfo } from '#swe/projectDetection';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { type FileExtractDetail, type SelectFilesAndExtractsResult, selectFilesAndExtracts } from './selectFilesAgentWithExtracts';
import * as selectFilesAgentWithSearchModule from './selectFilesAgentWithSearch';

describe.skip('selectFilesAndExtracts', () => {
	setupConditionalLoggerOutput();

	let queryWithFileSelection2Stub: sinon.SinonStub;
	let generateTextWithJsonStub: sinon.SinonStub;
	let readFileStub: sinon.SinonStub;
	let loggerErrorStub: sinon.SinonStub;
	let loggerWarnStub: sinon.SinonStub;
	let loggerInfoStub: sinon.SinonStub;

	const mockRequirementsString: UserContentExt = 'Test requirements as string';
	const mockRequirementsObject: UserContentExt = [{ type: 'text', text: 'Test requirements as object' }];
	const mockProjectInfo: ProjectInfo | undefined = undefined; // Keep it simple, can be expanded if needed

	beforeEach(() => {
		queryWithFileSelection2Stub = sinon.stub(selectFilesAgentWithSearchModule, 'queryWithFileSelection2');
		generateTextWithJsonStub = sinon.stub();
		readFileStub = sinon.stub();
		loggerErrorStub = sinon.stub(logger, 'error');
		loggerWarnStub = sinon.stub(logger, 'warn');
		loggerInfoStub = sinon.stub(logger, 'info');

		sinon.stub(agentContextLocalStorageModule, 'llms').returns({
			medium: {
				generateTextWithJson: generateTextWithJsonStub,
			},
		} as any);

		sinon.stub(agentContextLocalStorageModule, 'getFileSystem').returns({
			getWorkingDirectory: () => '/test/project',
			readFile: readFileStub,
		} as any);

		// Default mock-fs structure
		mock({
			'/test/project/file1.ts': 'console.log("hello world");',
			'/test/project/file2.md': '## Markdown File\nSome content here.',
			'/test/project/file3.txt': 'Text file content.',
		});
	});

	afterEach(() => {
		sinon.restore();
		mock.restore();
	});

	it('1. Happy Path: should correctly classify files, extract from read-only, and return results', async () => {
		const initialFiles: SelectedFile[] = [
			{ filePath: 'file1.ts', reason: 'Initial reason for file1' },
			{ filePath: 'file2.md', reason: 'Initial reason for file2' },
		];
		const answerFromQuery = 'Initial answer from query.';
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: answerFromQuery });

		// LLM Classification response
		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [
					{ filePath: 'file1.ts', status: 'editable', reason: 'Needs code changes' },
					{ filePath: 'file2.md', status: 'readonly', reason: 'Provides context' },
				],
			},
		});

		readFileStub.withArgs('/test/project/file2.md').resolves('1: ## Markdown File\n2: Some content here.');

		// LLM Extraction response for file2.md
		const file2ExtractDetail: FileExtractDetail = {
			extractReasoning: 'Critical context in file2.md',
			lineNumberExtracts: [{ from: 1, to: 2 }],
		};
		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', sinon.match(/sfawe-extract-file2_md/))).resolves({ object: file2ExtractDetail });

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });

		expect(result.answerFromInitialQuery).to.equal(answerFromQuery);
		expect(result.editableFiles).to.deep.equal([{ filePath: 'file1.ts', reason: 'Needs code changes', category: 'edit' }]);
		expect(result.readOnlyFilesWithExtracts).to.deep.equal({
			'file2.md': file2ExtractDetail,
		});
	});

	it('2. No Initial Files: should return empty results if queryWithFileSelection2 returns no files', async () => {
		const answerFromQuery = 'No files found for this query.';
		queryWithFileSelection2Stub.resolves({ files: [], answer: answerFromQuery });

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });

		expect(result.answerFromInitialQuery).to.equal(answerFromQuery);
		expect(result.editableFiles).to.be.empty;
		expect(result.readOnlyFilesWithExtracts).to.be.empty;
		expect(generateTextWithJsonStub.called).to.be.false; // No classification or extraction calls
		expect(loggerInfoStub.calledWith('selectFilesAndExtracts: No initial files selected by queryWithFileSelection2.')).to.be.true;
	});

	it('3. All Files Classified as Editable: should mark all files as editable and not attempt extraction', async () => {
		const initialFiles: SelectedFile[] = [
			{ filePath: 'file1.ts', reason: 'Reason 1' },
			{ filePath: 'file3.txt', reason: 'Reason 3' },
		];
		const answerFromQuery = 'Answer for editable files.';
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: answerFromQuery });

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [
					{ filePath: 'file1.ts', status: 'editable', reason: 'Edit file1' },
					{ filePath: 'file3.txt', status: 'editable', reason: 'Edit file3' },
				],
			},
		});

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });

		expect(result.answerFromInitialQuery).to.equal(answerFromQuery);
		expect(result.editableFiles).to.deep.equal([
			{ filePath: 'file1.ts', reason: 'Edit file1', category: 'edit' },
			{ filePath: 'file3.txt', reason: 'Edit file3', category: 'edit' },
		]);
		expect(result.readOnlyFilesWithExtracts).to.be.empty;
		// Ensure extraction was not called (only classification)
		expect(generateTextWithJsonStub.calledOnce).to.be.true;
		expect(generateTextWithJsonStub.firstCall.args[1].id).to.equal('sfawe-classification');
	});

	it('4. All Files Classified as ReadOnly: should mark all files as read-only and attempt extraction for all', async () => {
		const initialFiles: SelectedFile[] = [
			{ filePath: 'file2.md', reason: 'Reason 2' },
			{ filePath: 'file3.txt', reason: 'Reason 3' },
		];
		const answerFromQuery = 'Answer for read-only files.';
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: answerFromQuery });

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [
					{ filePath: 'file2.md', status: 'readonly', reason: 'Context from file2' },
					{ filePath: 'file3.txt', status: 'readonly', reason: 'Context from file3' },
				],
			},
		});

		readFileStub.withArgs('/test/project/file2.md').resolves('1: ## Markdown File\n2: Some content here.');
		readFileStub.withArgs('/test/project/file3.txt').resolves('1: Text file content.');

		const file2Extract: FileExtractDetail = { extractReasoning: 'Extract file2', lineNumberExtracts: [{ from: 1, to: 1 }] };
		const file3Extract: FileExtractDetail = { extractReasoning: 'Extract file3', lineNumberExtracts: [{ from: 1, to: 1 }] };

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', sinon.match(/sfawe-extract-file2_md/))).resolves({ object: file2Extract });
		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', sinon.match(/sfawe-extract-file3_txt/))).resolves({ object: file3Extract });

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });

		expect(result.answerFromInitialQuery).to.equal(answerFromQuery);
		expect(result.editableFiles).to.be.empty;
		expect(result.readOnlyFilesWithExtracts).to.deep.equal({
			'file2.md': file2Extract,
			'file3.txt': file3Extract,
		});
		expect(generateTextWithJsonStub.callCount).to.equal(3); // 1 classification, 2 extractions
	});

	it('5. Extraction LLM Call Fails for One Read-Only File: should handle error and process other files', async () => {
		const initialFiles: SelectedFile[] = [
			{ filePath: 'file2.md', reason: 'Reason 2' },
			{ filePath: 'file3.txt', reason: 'Reason 3' },
		];
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: 'Test' });

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [
					{ filePath: 'file2.md', status: 'readonly', reason: 'Context from file2' },
					{ filePath: 'file3.txt', status: 'readonly', reason: 'Context from file3' },
				],
			},
		});

		readFileStub.withArgs('/test/project/file2.md').resolves('File 2 content with lines');
		readFileStub.withArgs('/test/project/file3.txt').resolves('File 3 content with lines');

		// LLM for file2.md extraction fails
		generateTextWithJsonStub
			.withArgs(sinon.match.any, sinon.match.has('id', sinon.match(/sfawe-extract-file2_md/)))
			.rejects(new Error('LLM extraction failed for file2.md'));

		// LLM for file3.txt extraction succeeds
		const file3Extract: FileExtractDetail = { extractReasoning: 'Extract file3', lineNumberExtracts: [{ from: 1, to: 1 }] };
		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', sinon.match(/sfawe-extract-file3_txt/))).resolves({ object: file3Extract });

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });

		expect(result.editableFiles).to.be.empty;
		expect(result.readOnlyFilesWithExtracts['file2.md']).to.be.undefined;
		expect(result.readOnlyFilesWithExtracts['file3.txt']).to.deep.equal(file3Extract);
		expect(loggerErrorStub.calledWith(sinon.match.instanceOf(Error), 'selectFilesAndExtracts: Failed to extract from file2.md')).to.be.true;
	});

	it('6. Classification LLM Call Fails: should fallback to treating all initial files as editable', async () => {
		const initialFiles: SelectedFile[] = [
			{ filePath: 'file1.ts', reason: 'Initial reason 1' },
			{ filePath: 'file2.md', reason: 'Initial reason 2' },
		];
		const answerFromQuery = 'Answer when classification fails.';
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: answerFromQuery });

		// LLM Classification fails
		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).rejects(new Error('LLM classification failed'));

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });

		expect(result.answerFromInitialQuery).to.equal(answerFromQuery);
		expect(result.editableFiles).to.deep.equal([
			{ filePath: 'file1.ts', reason: 'Classification failed, defaulted to editable', category: 'edit' },
			{ filePath: 'file2.md', reason: 'Classification failed, defaulted to editable', category: 'edit' },
		]);
		expect(result.readOnlyFilesWithExtracts).to.be.empty;
		expect(loggerErrorStub.calledWith(sinon.match.instanceOf(Error), 'selectFilesAndExtracts: Failed to classify files.')).to.be.true;
		// Ensure extraction was not called
		expect(generateTextWithJsonStub.firstCall.args[1].id).to.equal('sfawe-classification');
		expect(generateTextWithJsonStub.callCount).to.equal(1);
	});

	it('7. readFileWithLineNumbers Fails for a Read-Only File: should handle error and skip extraction for that file', async () => {
		const initialFiles: SelectedFile[] = [{ filePath: 'file2.md', reason: 'Reason 2' }];
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: 'Test' });

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [{ filePath: 'file2.md', status: 'readonly', reason: 'Context from file2' }],
			},
		});

		// readFile for file2.md fails
		readFileStub.withArgs('/test/project/file2.md').rejects(new Error('Failed to read file'));

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });

		expect(result.editableFiles).to.be.empty;
		expect(result.readOnlyFilesWithExtracts['file2.md']).to.be.undefined;
		expect(loggerErrorStub.calledWith(sinon.match.instanceOf(Error), 'readFileWithLineNumbers: Error reading file file2.md')).to.be.true;
		expect(loggerWarnStub.calledWith('selectFilesAndExtracts: Could not read file2.md for extraction.')).to.be.true;
		// Ensure extraction LLM call was not made for file2.md
		expect(generateTextWithJsonStub.callCount).to.equal(1); // Only classification
	});

	it('8. LLM Returns Empty lineNumberExtracts for a Read-Only File: should include file with empty extracts', async () => {
		const initialFiles: SelectedFile[] = [{ filePath: 'file2.md', reason: 'Reason 2' }];
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: 'Test' });

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [{ filePath: 'file2.md', status: 'readonly', reason: 'Context from file2' }],
			},
		});

		readFileStub.withArgs('/test/project/file2.md').resolves('File content with lines');

		const file2ExtractEmpty: FileExtractDetail = {
			extractReasoning: 'Important context, but no specific lines',
			lineNumberExtracts: [],
		};
		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', sinon.match(/sfawe-extract-file2_md/))).resolves({ object: file2ExtractEmpty });

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });

		expect(result.editableFiles).to.be.empty;
		expect(result.readOnlyFilesWithExtracts['file2.md']).to.deep.equal(file2ExtractEmpty);
	});

	it('9. Input requirements Variations: should handle string and object requirements', async () => {
		const initialFiles: SelectedFile[] = [{ filePath: 'file1.ts', reason: 'Reason 1' }];
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: 'Test' });

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [{ filePath: 'file1.ts', status: 'editable', reason: 'Edit this' }],
			},
		});

		// Test with string requirements
		let result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });
		expect(result.editableFiles[0].filePath).to.equal('file1.ts');
		expect(
			generateTextWithJsonStub.firstCall.args[0][0].content.includes(
				typeof mockRequirementsString === 'string' ? mockRequirementsString : JSON.stringify(mockRequirementsString),
			),
		).to.be.true;

		// Reset stub for next call if necessary or use different stubs
		generateTextWithJsonStub.resetHistory();
		queryWithFileSelection2Stub.resetHistory();
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: 'Test' }); // Re-stub

		// Test with object requirements
		result = await selectFilesAndExtracts(mockRequirementsObject, { projectInfo: mockProjectInfo });
		expect(result.editableFiles[0].filePath).to.equal('file1.ts');
		expect(
			generateTextWithJsonStub.firstCall.args[0][0].content.includes(
				typeof mockRequirementsObject === 'string' ? mockRequirementsObject : JSON.stringify(mockRequirementsObject),
			),
		).to.be.true;
	});

	it('should handle classified file not in initial selection gracefully', async () => {
		const initialFiles: SelectedFile[] = [{ filePath: 'file1.ts', reason: 'Initial' }];
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: 'Test' });

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [
					{ filePath: 'file1.ts', status: 'editable', reason: 'Edit this' },
					{ filePath: 'non_existent_file.ts', status: 'editable', reason: 'Ghost file' },
				],
			},
		});

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });
		expect(result.editableFiles.length).to.equal(1);
		expect(result.editableFiles[0].filePath).to.equal('file1.ts');
		expect(loggerWarnStub.calledWith('selectFilesAndExtracts: Classified file non_existent_file.ts not in initial selection.')).to.be.true;
	});

	it('should handle malformed extraction response gracefully', async () => {
		const initialFiles: SelectedFile[] = [{ filePath: 'file2.md', reason: 'Initial' }];
		queryWithFileSelection2Stub.resolves({ files: initialFiles, answer: 'Test' });

		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', 'sfawe-classification')).resolves({
			object: {
				fileClassifications: [{ filePath: 'file2.md', status: 'readonly', reason: 'Read this' }],
			},
		});
		readFileStub.withArgs('/test/project/file2.md').resolves('1: Content');

		// Malformed response (missing lineNumberExtracts)
		generateTextWithJsonStub.withArgs(sinon.match.any, sinon.match.has('id', sinon.match(/sfawe-extract-file2_md/))).resolves({
			object: { extractReasoning: 'Some reason' } as any, // Cast to any to simulate malformed
		});

		const result = await selectFilesAndExtracts(mockRequirementsString, { projectInfo: mockProjectInfo });
		expect(result.readOnlyFilesWithExtracts['file2.md']).to.be.undefined;
		expect(loggerWarnStub.calledWith('selectFilesAndExtracts: Malformed extraction response for file2.md')).to.be.true;
	});
});
