import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import { Git } from '#functions/scm/git';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { MockLLM } from '#llm/services/mock-llm';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { SearchReplaceCoder } from './searchReplaceCoder';
import { SearchReplaceOrchestrator } from './searchReplaceOrchestrator';

const MOCK_REPO_ROOT = '/repo';

describe('SearchReplaceCoder', () => {
	setupConditionalLoggerOutput();

	let coder: SearchReplaceCoder;
	let mockLlms: AgentLLMs;
	let mockLLM: MockLLM;
	let fss: IFileSystemService;
	let mockVcs: sinon.SinonStubbedInstance<VersionControlSystem>;

	beforeEach(() => {
		mockFs({
			[MOCK_REPO_ROOT]: {
				'.gitignore': '',
				'test.ts': 'hello world',
			},
		});
		fss = new FileSystemService(MOCK_REPO_ROOT);
		fss.setWorkingDirectory(MOCK_REPO_ROOT);
		mockVcs = sinon.createStubInstance(Git);
		sinon.stub(fss, 'getVcsRoot').returns(MOCK_REPO_ROOT);
		sinon.stub(fss, 'getVcs').returns(mockVcs);

		mockLLM = new MockLLM();
		mockLlms = { easy: mockLLM, medium: mockLLM, hard: mockLLM, xhard: mockLLM };

		coder = new SearchReplaceCoder(mockLlms, fss);
	});

	afterEach(() => {
		sinon.restore();
		mockFs.restore();
	});

	it('should instantiate and call the orchestrator with the correct parameters', async () => {
		const orchestratorStub = sinon.stub(SearchReplaceOrchestrator.prototype, 'execute').resolves();

		await coder.editFilesToMeetRequirements('test', ['test.ts'], ['readonly.ts'], false, false);

		expect(orchestratorStub.calledOnce).to.be.true;

		const session = orchestratorStub.firstCall.args[0];
		expect(session.requirements).to.equal('test');
		expect(session.autoCommit).to.be.false;
		expect(session.dirtyCommits).to.be.false;
		expect(Array.from(session.absFnamesInChat)).to.deep.equal([`${MOCK_REPO_ROOT}/test.ts`]);

		const messages = orchestratorStub.firstCall.args[1];
		expect(messages.length).to.be.greaterThan(0);
		// Check that the prompt contains the file content
		expect(JSON.stringify(messages)).to.contain('hello world');

		const userRequest = orchestratorStub.firstCall.args[2];
		expect(userRequest).to.equal('test');

		const readOnlyFiles = orchestratorStub.firstCall.args[3];
		expect(readOnlyFiles).to.deep.equal(['readonly.ts']);
	});
});
