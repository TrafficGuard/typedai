import { expect } from 'chai';
import sinon from 'sinon';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { MockLLM } from '#llm/services/mock-llm';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { EditBlock } from './coderTypes';
import { SearchReplaceCoder } from './searchReplaceCoder';
import { EditSession } from './state/editSession';

/* ---------- test suite ---------- */
describe('SearchReplaceCoder – fileContentSnapshots', () => {
	setupConditionalLoggerOutput();

	const repoRoot = '/repo';
	const relFile = 'file.txt';
	const absFile = `${repoRoot}/${relFile}`;
	let fsStub: sinon.SinonStubbedInstance<FileSystemService>;
	let coder: SearchReplaceCoder;
	let session: EditSession;
	const failedEdits: EditBlock[] = [{ filePath: relFile, originalText: 'search', updatedText: 'replace' }];

	beforeEach(() => {
		fsStub = sinon.createStubInstance(FileSystemService);
		fsStub.getWorkingDirectory.returns(repoRoot);
		fsStub.fileExists.resolves(true);
		fsStub.getVcs.returns(null);
		fsStub.getVcsRoot.returns(repoRoot);

		const mockLLM = new MockLLM();
		const mockLlms: AgentLLMs = { easy: mockLLM, medium: mockLLM, hard: mockLLM, xhard: mockLLM };

		coder = new SearchReplaceCoder(mockLlms, fsStub as any);

		session = new EditSession(repoRoot, 'req', false, false);
		// store initial snapshot
		session.setFileSnapshot(relFile, 'initial');
	});

	afterEach(() => sinon.restore());

	it('returns empty array when file is unchanged', async () => {
		fsStub.readFile.withArgs(absFile).resolves('initial');
		const externalChanges = await coder.diagnoseFailures(failedEdits, session);
		expect(externalChanges).to.be.empty;
	});

	it('detects external content change', async () => {
		fsStub.readFile.withArgs(absFile).resolves('modified');
		const externalChanges = await coder.diagnoseFailures(failedEdits, session);
		expect(externalChanges).to.deep.equal([relFile]);
	});

	it('detects file deletion', async () => {
		fsStub.readFile.withArgs(absFile).rejects(new Error('ENOENT'));
		const externalChanges = await coder.diagnoseFailures(failedEdits, session);
		expect(externalChanges).to.deep.equal([relFile]);
	});
});
