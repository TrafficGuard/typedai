import * as path from 'node:path';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/services/fileSystemService';
import type { VersionControlSystem } from '#shared/services/versionControlSystem';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock } from './coderTypes';
import { EditApplier } from './editApplier';

describe('EditApplier', () => {
	setupConditionalLoggerOutput();
	const testRoot = '/test-repo';
	const defaultFence: [string, string] = ['```', '```'];

	let mockFileSystemService: sinon.SinonStubbedInstance<FileSystemService>;
	let mockVCS: sinon.SinonStubbedInstance<VersionControlSystem>;

	beforeEach(() => {
		mockFileSystemService = sinon.createStubInstance(FileSystemService);

		// Configure default behaviors for methods used by EditApplier or test setup
		mockFileSystemService.fileExists.resolves(false); // Default: file does not exist
		mockFileSystemService.readFile.resolves(null); // Default: file not found or empty
		mockFileSystemService.writeFile.resolves(); // Default: write succeeds

		mockVCS = {
			isDirty: sinon.stub<[string], Promise<boolean>>().resolves(false),
			addAllTrackedAndCommit: sinon.stub<[string], Promise<void>>().resolves(),
			getBranchName: sinon.stub<[], Promise<string>>().resolves('main'),
			getHeadSha: sinon.stub<[], Promise<string>>().resolves('dummySha'),
			getDiff: sinon.stub<[string?], Promise<string>>().resolves(''),
			createBranch: sinon.stub<[string], Promise<boolean>>().resolves(true),
			switchToBranch: sinon.stub<[string], Promise<void>>().resolves(),
			pull: sinon.stub<[], Promise<void>>().resolves(),
			getAddedFiles: sinon.stub<[string?], Promise<string[]>>().resolves([]),
			getRecentCommits: sinon.stub<[number], Promise<import('#shared/services/versionControlSystem').Commit[]>>().resolves([]),
			isRepoDirty: sinon.stub<[], Promise<boolean>>().resolves(false),
			revertFile: sinon.stub<[string], Promise<void>>().resolves(),
			commit: sinon.stub<[string], Promise<void>>().resolves(),
			mergeChangesIntoLatestCommit: sinon.stub<[string[]], Promise<void>>().resolves(),
		};
		// Ensure the getVcs method on the stubbed FileSystemService returns the mockVCS
		mockFileSystemService.getVcs.returns(mockVCS as any);
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

		const applier = new EditApplier(mockFileSystemService, mockVCS, true, defaultFence, testRoot, new Set(), false, false);
		const block = createBlock(filePath, 'Hello world.', 'Hello universe.');
		const { appliedFilePaths, failedEdits } = await applier.apply([block]);

		expect(failedEdits).to.be.empty;
		expect(appliedFilePaths).to.have.keys(filePath);
		sinon.assert.calledOnceWithExactly(mockFileSystemService.writeFile, absFilePath, `${newContent}\n`);
	});

	it('should create a new file when SEARCH block is empty', async () => {
		const filePath = 'new_file.txt';
		const absFilePath = path.join(testRoot, filePath);
		const newContent = 'This is new.';

		mockFileSystemService.fileExists.withArgs(absFilePath).resolves(false); // File does not exist

		const applier = new EditApplier(mockFileSystemService, mockVCS, true, defaultFence, testRoot, new Set(), false, false);
		const block = createBlock(filePath, '', newContent); // Empty originalText
		const { appliedFilePaths, failedEdits } = await applier.apply([block]);

		expect(failedEdits).to.be.empty;
		expect(appliedFilePaths).to.have.keys(filePath);
		sinon.assert.calledOnceWithExactly(mockFileSystemService.writeFile, absFilePath, `${newContent}\n`);
	});

	it('should fail if SEARCH block not found and no fallback', async () => {
		const filePath = 'file1.txt';
		const absFilePath = path.join(testRoot, filePath);
		const initialContent = 'Actual content.';

		mockFileSystemService.fileExists.withArgs(absFilePath).resolves(true);
		mockFileSystemService.readFile.withArgs(absFilePath).resolves(initialContent);

		const applier = new EditApplier(mockFileSystemService, mockVCS, true, defaultFence, testRoot, new Set(), false, false);
		const block = createBlock(filePath, 'NonExistentSearch', 'Update');
		const { appliedFilePaths, failedEdits } = await applier.apply([block]);

		expect(appliedFilePaths).to.be.empty;
		expect(failedEdits).to.deep.equal([block]);
		sinon.assert.notCalled(mockFileSystemService.writeFile);
	});

	it('should use fallback file if initial apply fails and fallback succeeds', async () => {
		const originalFilePath = 'original.txt';
		const absOriginalFilePath = path.join(testRoot, originalFilePath);
		const fallbackFilePath = 'fallback.txt';
		const absFallbackFilePath = path.join(testRoot, fallbackFilePath);

		const originalContent = 'Content of original file.';
		const fallbackContent = 'Search this in fallback.\nMore lines.';
		const replacement = 'Replaced in fallback.';

		mockFileSystemService.fileExists.withArgs(absOriginalFilePath).resolves(true);
		mockFileSystemService.readFile.withArgs(absOriginalFilePath).resolves(originalContent);
		mockFileSystemService.fileExists.withArgs(absFallbackFilePath).resolves(true);
		mockFileSystemService.readFile.withArgs(absFallbackFilePath).resolves(fallbackContent);

		const absFnamesInChat = new Set([absOriginalFilePath, absFallbackFilePath]);
		const applier = new EditApplier(mockFileSystemService, mockVCS, true, defaultFence, testRoot, absFnamesInChat, false, false);

		// This block will fail on original.txt but succeed on fallback.txt
		const block = createBlock(originalFilePath, 'Search this in fallback.', replacement);
		const { appliedFilePaths, failedEdits } = await applier.apply([block]);

		expect(failedEdits).to.be.empty;
		expect(appliedFilePaths).to.have.keys(fallbackFilePath); // Applied to fallback
		expect(appliedFilePaths.size).to.equal(1);
		sinon.assert.calledOnceWithExactly(mockFileSystemService.writeFile, absFallbackFilePath, `${replacement}\nMore lines.\n`);
	});

	it('should auto-commit if autoCommit is true, not dryRun, and edits passed', async () => {
		const filePath = 'file_to_commit.txt';
		const absFilePath = path.join(testRoot, filePath);
		mockFileSystemService.fileExists.withArgs(absFilePath).resolves(false); // New file

		const applier = new EditApplier(mockFileSystemService, mockVCS, true, defaultFence, testRoot, new Set(), true, false); // autoCommit = true
		const block = createBlock(filePath, '', 'New content for commit.');
		await applier.apply([block]);

		sinon.assert.calledOnce(mockVCS.addAllTrackedAndCommit);
		sinon.assert.calledWithExactly(mockVCS.addAllTrackedAndCommit, 'Applied LLM-generated edits');
	});

	it('should NOT auto-commit if dryRun is true', async () => {
		const filePath = 'file_dry_run.txt';
		const absFilePath = path.join(testRoot, filePath);
		mockFileSystemService.fileExists.withArgs(absFilePath).resolves(false);

		const applier = new EditApplier(mockFileSystemService, mockVCS, true, defaultFence, testRoot, new Set(), true, true); // dryRun = true
		const block = createBlock(filePath, '', 'Dry run content.');
		await applier.apply([block]);

		sinon.assert.notCalled(mockVCS.addAllTrackedAndCommit);
		sinon.assert.notCalled(mockFileSystemService.writeFile); // Also check no write for dry run
	});

	it('should NOT auto-commit if no edits passed', async () => {
		const filePath = 'file_fail_commit.txt';
		const absFilePath = path.join(testRoot, filePath);
		mockFileSystemService.fileExists.withArgs(absFilePath).resolves(true);
		mockFileSystemService.readFile.withArgs(absFilePath).resolves('Initial');

		const applier = new EditApplier(mockFileSystemService, mockVCS, true, defaultFence, testRoot, new Set(), true, false);
		const block = createBlock(filePath, 'SearchFail', 'Update'); // This will fail
		await applier.apply([block]);

		sinon.assert.notCalled(mockVCS.addAllTrackedAndCommit);
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

		const applier = new EditApplier(mockFileSystemService, mockVCS, true, defaultFence, testRoot, new Set(), false, false);
		const passingBlock = createBlock(passFilePath, 'Pass original.', 'Pass updated.');
		const failingBlock = createBlock(failFilePath, 'Search text not in file.', 'Fail update.');

		const { appliedFilePaths, failedEdits } = await applier.apply([passingBlock, failingBlock]);

		expect(appliedFilePaths).to.have.keys(passFilePath);
		expect(appliedFilePaths.size).to.equal(1);
		expect(failedEdits).to.deep.equal([failingBlock]);
		sinon.assert.calledOnceWithExactly(mockFileSystemService.writeFile, absPassFilePath, 'Pass updated.\n');
	});
});
