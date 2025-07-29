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
import { EditSession } from '../state/editSession';
import { EditPreparer } from './editPreparer';

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
		session = new EditSession(MOCK_REPO_ROOT, 'test request', false, false);
	});

	afterEach(() => {
		sinon.restore();
		mockFs.restore();
	});

	describe('Successful Preparation', () => {
		it('should return a valid block for an existing, clean file already in context', async () => {
			const filePath = 'existing.ts';
			const absPath = join(MOCK_REPO_ROOT, filePath);
			session.addFileToChat(absPath);
			mockVcs.isDirty.withArgs(filePath).resolves(false);

			const blocks = [createBlock(filePath, 'initial content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.validBlocks[0]).to.deep.equal(blocks[0]);
		});

		it('should allow creating a new file if the SEARCH block is empty', async () => {
			const filePath = 'new-file.ts';
			const absPath = join(MOCK_REPO_ROOT, filePath);
			const blocks = [createBlock(filePath, '', 'new content')];

			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(result.validBlocks[0]).to.deep.equal(blocks[0]);
			expect(session.absFnamesInChat.has(absPath)).to.be.true;
		});

		it('should allow creating a new file if the SEARCH block contains only whitespace', async () => {
			const filePath = 'new-file.ts';
			const blocks = [createBlock(filePath, '  \n\t  ', 'new content')];

			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
		});

		it('should allow editing an existing file not previously in the session context', async () => {
			const filePath = 'existing.ts';
			const absPath = join(MOCK_REPO_ROOT, filePath);
			expect(session.absFnamesInChat.has(absPath)).to.be.false;

			const blocks = [createBlock(filePath, 'initial content', 'new content')];
			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.have.lengthOf(1);
			expect(session.absFnamesInChat.has(absPath)).to.be.true;
		});
	});

	describe('Permission and Validation', () => {
		it('should disallow editing a non-existent file with a non-empty SEARCH block', async () => {
			const filePath = 'non-existent.ts';
			const blocks = [createBlock(filePath, 'some search content', 'new content')];

			const result = await preparer.prepare(blocks, session);

			expect(result.validBlocks).to.be.empty;
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
		});
	});
});
