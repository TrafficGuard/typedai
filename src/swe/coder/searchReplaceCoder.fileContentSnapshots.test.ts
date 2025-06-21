import { expect } from 'chai';
import sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock } from './coderTypes';
import { newSession } from './state/EditSession';
import { SearchReplaceCoder } from './searchReplaceCoder';

/* ---------- helpers ---------- */
function mkDummyLLM() {
	const genMsg = sinon.stub().resolves({ role: 'assistant', content: '' });
	return { generateMessage: genMsg, getModel: () => 'dummy', getMaxInputTokens: () => 8_000 };
}
const dummyLLMs = { medium: mkDummyLLM(), hard: mkDummyLLM() } as any;

/* ---------- test suite ---------- */
describe('SearchReplaceCoder – fileContentSnapshots', () => {
	setupConditionalLoggerOutput();

	const repoRoot = '/repo';
	const relFile = 'file.txt';
	const absFile = `${repoRoot}/${relFile}`;
	let fsStub: sinon.SinonStubbedInstance<FileSystemService>;
	let coder: SearchReplaceCoder;
	let session: ReturnType<typeof newSession>;
	const targetBlocks: EditBlock[] = [{ filePath: relFile, originalText: '', updatedText: '' }];

	beforeEach(() => {
		fsStub = sinon.createStubInstance(FileSystemService);
		fsStub.getWorkingDirectory.returns(repoRoot);
		fsStub.fileExists.resolves(true);
		session = newSession(repoRoot, 'req');
		coder = new SearchReplaceCoder(dummyLLMs, fsStub as unknown as IFileSystemService);
		// store initial snapshot
		session.fileContentSnapshots.set(relFile, 'initial');
	});

	afterEach(() => sinon.restore());

	it('returns empty array when file is unchanged', async () => {
		fsStub.readFile.withArgs(absFile).resolves('initial');
		const changed = await (coder as any)._detectExternalChanges(session, targetBlocks);
		expect(changed).to.be.empty;
	});

	it('detects external content change', async () => {
		fsStub.readFile.withArgs(absFile).resolves('modified');
		const changed = await (coder as any)._detectExternalChanges(session, targetBlocks);
		expect(changed).to.deep.equal([relFile]);
	});

	it('detects file deletion', async () => {
		fsStub.readFile.withArgs(absFile).rejects(new Error('ENOENT'));
		const changed = await (coder as any)._detectExternalChanges(session, targetBlocks);
		expect(changed).to.deep.equal([relFile]);
	});
});
