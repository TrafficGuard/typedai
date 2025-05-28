import * as path from 'node:path';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import { logger } from '#o11y/logger';
import type { IFileSystemService } from '#shared/services/fileSystemService';
import type { VersionControlSystem } from '#shared/services/versionControlSystem';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { EditApplier } from './EditApplier';
import type { EditBlock } from './applySearchReplace';

describe('EditApplier', () => {
	setupConditionalLoggerOutput();
	const testRoot = '/test-repo';
	const defaultFence: [string, string] = ['```', '```'];

	let mockFileSystemService: sinon.SinonStubbedInstance<IFileSystemService>;
	let mockVCS: sinon.SinonStubbedInstance<VersionControlSystem>;

	beforeEach(() => {
		mockFileSystemService = {
			fileExists: sinon.stub<[string], Promise<boolean>>(),
			readFile: sinon.stub<[string], Promise<string | null>>(),
			writeFile: sinon.stub<[string, string], Promise<void>>(),
			// Stubs for other IFileSystemService methods if needed by EditApplier indirectly
			// For now, focusing on what EditApplier.apply directly uses.
			getBasePath: sinon.stub<[], string>().returns(testRoot),
			getWorkingDirectory: sinon.stub<[], string>().returns(testRoot),
			getVcs: sinon.stub<[], VersionControlSystem>().returns(mockVCS as any), // Cast since mockVCS is stubbed
			getVcsRoot: sinon.stub<[], string | null>().returns(testRoot), // Assume VCS is available
			listFilesRecursively: sinon.stub<[string?, boolean?], Promise<string[]>>().resolves([]),
			ensureDir: sinon.stub<[string], Promise<void>>().resolves(),
			deleteFile: sinon.stub<[string], Promise<void>>().resolves(),
			renameFile: sinon.stub<[string, string], Promise<void>>().resolves(),
			copyFile: sinon.stub<[string, string], Promise<void>>().resolves(),
			isIgnored: sinon.stub<[string], Promise<boolean>>().resolves(false),
			readFilesAsXml: sinon.stub<[string | string[]], Promise<string>>().resolves(''),
			fromJSON: sinon.stub<[any], IFileSystemService | null>().returns(mockFileSystemService),
			toJSON: sinon.stub<[], { basePath: string; workingDirectory: string }>().returns({ basePath: testRoot, workingDirectory: testRoot }),
			// Default stubs for other methods to satisfy the SinonStubbedInstance type, if not specifically tested.
			// These may need specific typings if used in tests.
			setWorkingDirectory: sinon.stub<[string], void>(),
			getFileContentsRecursively: sinon.stub<[string, boolean?], Promise<Map<string, string>>>().resolves(new Map()),
			getFileContentsRecursivelyAsXml: sinon.stub<[string, boolean, ((path: string) => boolean)?], Promise<string>>().resolves(''),
			searchFilesMatchingContents: sinon.stub<[string], Promise<string>>().resolves(''),
			searchExtractsMatchingContents: sinon.stub<[string, number?], Promise<string>>().resolves(''),
			searchFilesMatchingName: sinon.stub<[string], Promise<string[]>>().resolves([]),
			listFilesInDirectory: sinon.stub<[string?], Promise<string[]>>().resolves([]),
			listFilesRecurse: sinon.stub<[string, string, any, boolean, string | null, ((file: string) => boolean)?], Promise<string[]>>().resolves([]),
			readFileAsXML: sinon.stub<[string], Promise<string>>().resolves(''),
			readFiles: sinon.stub<[string[]], Promise<Map<string, string>>>().resolves(new Map()),
			formatFileContentsAsXml: sinon.stub<[Map<string, string>], string>().returns(''),
			directoryExists: sinon.stub<[string], Promise<boolean>>().resolves(false),
			writeNewFile: sinon.stub<[string, string], Promise<void>>().resolves(),
			editFileContents: sinon.stub<[string, string], Promise<void>>().resolves(),
			loadGitignoreRules: sinon.stub<[string, string | null], Promise<any>>().resolves({} as any),
			listFolders: sinon.stub<[string?], Promise<string[]>>().resolves([]),
			getAllFoldersRecursively: sinon.stub<[string?], Promise<string[]>>().resolves([]),
			getFileSystemTree: sinon.stub<[string?], Promise<string>>().resolves(''),
			getFileSystemTreeStructure: sinon.stub<[string?], Promise<Record<string, string[]>>>().resolves({}),
			getFileSystemNodes: sinon.stub<[string?, boolean?], Promise<any | null>>().resolves(null),
			buildNodeTreeRecursive: sinon.stub<[string, string, any, boolean, string | null], Promise<any[]>>().resolves([]),
		};

		mockVCS = {
			isDirty: sinon.stub<[string], Promise<boolean>>(),
			addAllTrackedAndCommit: sinon.stub<[string], Promise<void>>(),
			getBranchName: sinon.stub<[], Promise<string>>(),
			getHeadSha: sinon.stub<[], Promise<string>>(),
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
		mockFileSystemService.getVcs.returns(mockVCS as any);

		// Restore mock-fs before each test to ensure clean state
		mockFs.restore();
	});

	afterEach(() => {
		sinon.restore();
		mockFs.restore(); // Ensure mock-fs is restored after each test
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
