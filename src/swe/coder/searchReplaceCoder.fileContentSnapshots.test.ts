import { expect } from 'chai';
import sinon from 'sinon';
import { Git } from '#functions/scm/git';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock } from './coderTypes';
import { EditPreparer } from './services/EditPreparer';
import { EditSession } from './state/EditSession';

/* ---------- test suite ---------- */
describe('SearchReplaceCoder – fileContentSnapshots', () => {
	setupConditionalLoggerOutput();

	const repoRoot = '/repo';
	const relFile = 'file.txt';
	const absFile = `${repoRoot}/${relFile}`;
	let fsStub: sinon.SinonStubbedInstance<FileSystemService>;
	let preparer: EditPreparer;
	let session: EditSession;
	const targetBlocks: EditBlock[] = [{ filePath: relFile, originalText: '', updatedText: '' }];

	beforeEach(() => {
		fsStub = sinon.createStubInstance(FileSystemService);
		fsStub.getWorkingDirectory.returns(repoRoot);
		fsStub.fileExists.resolves(true);
		session = new EditSession(repoRoot, 'req', false, false);
		const vcs = sinon.createStubInstance(Git);
		preparer = new EditPreparer(fsStub as any, vcs, ['', '']);
		// store initial snapshot
		session.setFileSnapshot(relFile, 'initial');
	});

	afterEach(() => sinon.restore());

	it('returns empty array when file is unchanged', async () => {
		fsStub.readFile.withArgs(absFile).resolves('initial');
		const { externalChanges } = await preparer.prepare(targetBlocks, session);
		expect(externalChanges).to.be.empty;
	});

	it('detects external content change', async () => {
		fsStub.readFile.withArgs(absFile).resolves('modified');
		const { externalChanges } = await preparer.prepare(targetBlocks, session);
		expect(externalChanges).to.deep.equal([relFile]);
	});

	it('detects file deletion', async () => {
		fsStub.readFile.withArgs(absFile).rejects(new Error('ENOENT'));
		const { externalChanges } = await preparer.prepare(targetBlocks, session);
		expect(externalChanges).to.deep.equal([relFile]);
	});
});
