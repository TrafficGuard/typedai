import * as path from 'node:path';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock } from './coderTypes';
import { type ApplyEditsOptions, applyEdits } from './editApplier';

describe('applyEdits', () => {
	setupConditionalLoggerOutput();
	const testRoot = '/test-repo';
	const defaultFence: [string, string] = ['```', '```'];

	let mockFileSystemService: sinon.SinonStubbedInstance<IFileSystemService>;
	let defaultOptions: ApplyEditsOptions;

	beforeEach(() => {
		mockFileSystemService = sinon.createStubInstance(FileSystemService);

		// Configure default behaviors for methods used by applyEdits or test setup
		mockFileSystemService.fileExists.resolves(false); // Default: file does not exist
		mockFileSystemService.readFile.resolves(''); // Default: file not found or empty
		mockFileSystemService.writeFile.resolves(); // Default: write succeeds

		defaultOptions = {
			fs: mockFileSystemService,
			lenientWhitespace: true,
			fence: defaultFence,
			rootPath: testRoot,
		};
	});

	afterEach(() => {
		sinon.restore();
		mockFs.restore();
	});

	const createBlock = (filePath: string, original: string, updated: string): EditBlock => ({
		filePath,
		originalText: original,
		updatedText: updated,
	});

	it('should apply a simple replacement to an existing file', async () => {
		const filePath = 'file1.txt';
		const absFilePath = path.join(testRoot, filePath);
		const initialContent = 'Hello world.';
		const newContent = 'Hello universe.';

		mockFileSystemService.fileExists.withArgs(absFilePath).resolves(true);
		mockFileSystemService.readFile.withArgs(absFilePath).resolves(initialContent);

		const block = createBlock(filePath, 'Hello world.', 'Hello universe.');
		const { appliedFilePaths, failedEdits } = await applyEdits([block], defaultOptions);

		expect(failedEdits).to.be.empty;
		expect(appliedFilePaths.has(filePath)).to.be.true;
		sinon.assert.calledOnceWithExactly(mockFileSystemService.writeFile, absFilePath, `${newContent}\n`);
	});

	it('should create a new file when SEARCH block is empty', async () => {
		const filePath = 'new_file.txt';
		const absFilePath = path.join(testRoot, filePath);
		const newContent = 'This is new.';

		mockFileSystemService.fileExists.withArgs(absFilePath).resolves(false); // File does not exist

		const block = createBlock(filePath, '', newContent); // Empty originalText
		const { appliedFilePaths, failedEdits } = await applyEdits([block], defaultOptions);

		expect(failedEdits).to.be.empty;
		expect(appliedFilePaths.has(filePath)).to.be.true;
		sinon.assert.calledOnceWithExactly(mockFileSystemService.writeFile, absFilePath, `${newContent}\n`);
	});

	it('should fail if SEARCH block not found and no fallback', async () => {
		const filePath = 'file1.txt';
		const absFilePath = path.join(testRoot, filePath);
		const initialContent = 'Actual content.';

		mockFileSystemService.fileExists.withArgs(absFilePath).resolves(true);
		mockFileSystemService.readFile.withArgs(absFilePath).resolves(initialContent);

		const block = createBlock(filePath, 'NonExistentSearch', 'Update');
		const { appliedFilePaths, failedEdits } = await applyEdits([block], defaultOptions);

		expect(appliedFilePaths).to.be.empty;
		expect(failedEdits).to.deep.equal([block]);
		sinon.assert.notCalled(mockFileSystemService.writeFile);
	});

	it('should handle multiple blocks, some failing, some passing', async () => {
		const passFilePath = 'pass.txt';
		const absPassFilePath = path.join(testRoot, passFilePath);
		const failFilePath = 'fail.txt';
		const absFailFilePath = path.join(testRoot, failFilePath);

		mockFileSystemService.fileExists.withArgs(absPassFilePath).resolves(true);
		mockFileSystemService.readFile.withArgs(absPassFilePath).resolves('Pass original.');
		mockFileSystemService.fileExists.withArgs(absFailFilePath).resolves(true);
		mockFileSystemService.readFile.withArgs(absFailFilePath).resolves('Fail original.');

		const passingBlock = createBlock(passFilePath, 'Pass original.', 'Pass updated.');
		const failingBlock = createBlock(failFilePath, 'Search text not in file.', 'Fail update.');

		const { appliedFilePaths, failedEdits } = await applyEdits([passingBlock, failingBlock], defaultOptions);

		expect(appliedFilePaths.has(passFilePath)).to.be.true;
		expect(appliedFilePaths.size).to.equal(1);
		expect(failedEdits).to.deep.equal([failingBlock]);
		sinon.assert.calledOnceWithExactly(mockFileSystemService.writeFile, absPassFilePath, 'Pass updated.\n');
	});
});
