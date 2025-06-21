import { join } from 'node:path';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import { Git } from '#functions/scm/git';
import { FileSystemService } from '#functions/storage/fileSystemService';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock } from '../coderTypes';
import { type EditSession, newSession } from '../state/EditSession';
import { EditPreparer } from './EditPreparer';

const MOCK_REPO_ROOT = '/repo';
// The fence values don't matter for most tests, but are required by the constructor.
const FENCE: [string, string] = ['<<<<<<< SEARCH', '>>>>>>> REPLACE'];

const createBlock = (filePath: string, originalText: string, updatedText: string): EditBlock => ({
	filePath,
	originalText,
	updatedText,
});

describe('EditPreparer', () => {
	setupConditionalLoggerOutput();

	let preparer: EditPreparer;
	let mockFss: IFileSystemService;
	let mockVcs: sinon.SinonStubbedInstance<VersionControlSystem>;
	let session: EditSession;

	beforeEach(() => {
		mockFs({
			[MOCK_REPO_ROOT]: {
				'existing.ts': 'initial content',
				'dirty.ts': 'dirty content',
			},
		});

		mockFss = new FileSystemService(MOCK_REPO_ROOT);
		mockVcs = sinon.createStubInstance(Git);

		preparer = new EditPreparer(mockFss, mockVcs, FENCE);
		session = newSession(MOCK_REPO_ROOT, 'test request');
	});

	afterEach(() => {
		sinon.restore();
		mockFs.restore();
	});

	describe('Successful Preparation', () => {
		it('should return a valid block for an existing, clean file already in context', async () => {
			const filePath = 'existing.ts';
			const absPath = join(MOCK_REPO_ROOT, filePath);
			session.absFnamesInChat?.add(absPath);
			mockVcs.isDirty.withArgs(filePath).resolves(false);

			const blocks = [createBlock(filePath, 'initial content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.validBlocks[0]).to.deep.equal(blocks[0]);
			expect(result.dirtyFiles.size).to.equal(0);
			expect(result.externalChanges).to.be.empty;
		});

		it('should allow creating a new file if the SEARCH block is empty', async () => {
			const filePath = 'new-file.ts';
			const absPath = join(MOCK_REPO_ROOT, filePath);
			const blocks = [createBlock(filePath, '', 'new content')];

			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.validBlocks[0]).to.deep.equal(blocks[0]);
			expect(result.dirtyFiles.size).to.equal(0);
			expect(result.externalChanges).to.be.empty;
			expect(session.absFnamesInChat?.has(absPath)).to.be.true;
		});

		it('should allow creating a new file if the SEARCH block contains only whitespace', async () => {
			const filePath = 'new-file.ts';
			const blocks = [createBlock(filePath, '  \n\t  ', 'new content')];

			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.dirtyFiles.size).to.equal(0);
		});

		it('should allow editing an existing file not previously in the session context', async () => {
			const filePath = 'existing.ts';
			const absPath = join(MOCK_REPO_ROOT, filePath);
			expect(session.absFnamesInChat?.has(absPath)).to.be.false;

			const blocks = [createBlock(filePath, 'initial content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.dirtyFiles.size).to.equal(0);
			expect(result.externalChanges).to.be.empty;
			expect(session.absFnamesInChat?.has(absPath)).to.be.true;
		});
	});

	describe('External Change Detection', () => {
		it('should detect external changes if file content was modified since snapshot', async () => {
			const filePath = 'existing.ts';
			session.fileContentSnapshots.set(filePath, 'snapshot content'); // Different from 'initial content' on disk

			const blocks = [createBlock(filePath, 'snapshot content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.externalChanges).to.deep.equal([filePath]);
			expect(result.validBlocks).to.be.empty;
			expect(result.dirtyFiles.size).to.equal(0);
		});

		it('should detect external changes if a file was deleted since snapshot', async () => {
			const filePath = 'deleted-file.ts';
			session.fileContentSnapshots.set(filePath, 'i existed once');
			// File does not exist in mock-fs

			const blocks = [createBlock(filePath, 'i existed once', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.externalChanges).to.deep.equal([filePath]);
			expect(result.validBlocks).to.be.empty;
		});

		it('should short-circuit and not validate blocks if external changes are found', async () => {
			const changedFile = 'existing.ts';
			const invalidFile = 'non-existent.ts';
			session.fileContentSnapshots.set(changedFile, 'snapshot content'); // Will trigger external change

			const blocks = [
				createBlock(changedFile, 'snapshot content', 'new content'),
				createBlock(invalidFile, 'some search content', 'new content'), // This block is invalid
			];
			const result = await preparer.prepare(blocks, session);

			// It should stop after detecting the change and not even process the invalid block
			expect(result.externalChanges).to.deep.equal([changedFile]);
			expect(result.validBlocks).to.be.empty; // No blocks should be validated
		});

		it('should not report external changes for files without a snapshot', async () => {
			const filePath = 'existing.ts';
			// No snapshot for 'existing.ts' in the session

			const blocks = [createBlock(filePath, 'initial content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.externalChanges).to.be.empty;
			expect(result.validBlocks).to.have.lengthOf(1);
		});
	});

	describe('Dirty File Handling', () => {
		it('should identify an initially dirty file that is still dirty', async () => {
			const filePath = 'dirty.ts';
			const absPath = join(MOCK_REPO_ROOT, filePath);
			session.absFnamesInChat?.add(absPath);
			session.initiallyDirtyFiles?.add(filePath);
			mockVcs.isDirty.withArgs(filePath).resolves(true);

			const blocks = [createBlock(filePath, 'dirty content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.dirtyFiles.has(filePath)).to.be.true;
			expect(result.externalChanges).to.be.empty;
		});

		it('should not mark a file as dirty if it was initially dirty but is now clean', async () => {
			const filePath = 'dirty.ts';
			const absPath = join(MOCK_REPO_ROOT, filePath);
			session.absFnamesInChat?.add(absPath);
			session.initiallyDirtyFiles?.add(filePath);
			mockVcs.isDirty.withArgs(filePath).resolves(false); // VCS now reports the file as clean

			const blocks = [createBlock(filePath, 'dirty content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.dirtyFiles.has(filePath)).to.be.false;
		});

		it('should not perform dirty checks if VCS is not available', async () => {
			preparer = new EditPreparer(mockFss, null, FENCE); // Recreate preparer without VCS
			const filePath = 'dirty.ts';
			session.initiallyDirtyFiles?.add(filePath);

			const blocks = [createBlock(filePath, 'dirty content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.dirtyFiles.size).to.equal(0); // No VCS means no dirty check
		});
	});

	describe('Permission and Validation', () => {
		it('should disallow editing a non-existent file with a non-empty SEARCH block', async () => {
			const filePath = 'non-existent.ts';
			const blocks = [createBlock(filePath, 'some search content', 'new content')];

			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.be.empty;
			expect(result.dirtyFiles.size).to.equal(0);
			expect(result.externalChanges).to.be.empty;
		});

		it('should handle multiple blocks, filtering out invalid ones', async () => {
			const validBlock = createBlock('existing.ts', 'initial content', 'new');
			const invalidBlock = createBlock('non-existent.ts', 'search content', 'new');
			const createBlockValid = createBlock('new-file.ts', '', 'new');

			const blocks: EditBlock[] = [validBlock, invalidBlock, createBlockValid];
			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(2);
			expect(result.validBlocks).to.deep.include(validBlock);
			expect(result.validBlocks).to.deep.include(createBlockValid);
			expect(result.validBlocks).to.not.deep.include(invalidBlock);
			expect(result.dirtyFiles.size).to.equal(0);
			expect(result.externalChanges).to.be.empty;
		});
	});
});
