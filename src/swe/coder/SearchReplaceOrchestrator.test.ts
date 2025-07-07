import { existsSync } from 'node:fs';
import { expect } from 'chai';
import mockFs from 'mock-fs';
import * as sinon from 'sinon';
import { Git } from '#functions/scm/git';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { MockLLM } from '#llm/services/mock-llm';
import { logger } from '#o11y/logger';
import type { AgentLLMs } from '#shared/agent/agent.model';
import type { IFileSystemService } from '#shared/files/fileSystemService';
import type { VersionControlSystem } from '#shared/scm/versionControlSystem';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { CoderExhaustedAttemptsError } from '../sweErrors';
import { DIVIDER_MARKER, REPLACE_MARKER, SEARCH_MARKER } from './constants';
import { SearchReplaceCoder } from './searchReplaceCoder';

const MOCK_REPO_ROOT = '/repo';

function searchReplaceBlock(filePath: string, search: string, replace: string): string {
	return `${filePath}
\`\`\`typescript
${SEARCH_MARKER}
${search}
${DIVIDER_MARKER}
${replace}
${REPLACE_MARKER}
\`\`\`
`;
}

const SEARCH_BLOCK_VALID = searchReplaceBlock('test.ts', 'hello world', 'hello universe');

describe('SearchReplaceOrchestrator: Full Integration', () => {
	setupConditionalLoggerOutput();

	let coder: SearchReplaceCoder;
	let mockLlms: AgentLLMs;
	let mockLLM: MockLLM;
	let fss: IFileSystemService;
	let mockVcs: sinon.SinonStubbedInstance<VersionControlSystem>;
	let execCommandStub: sinon.SinonStub;

	function setupMockFs(mockFileSystemConfig: any): void {
		mockFileSystemConfig[`${MOCK_REPO_ROOT}/.gitignore`] = '';
		mockFs(mockFileSystemConfig);

		const existsSyncStub = sinon.stub(require('node:fs'), 'existsSync');
		existsSyncStub.callsFake((path: unknown) => {
			const pathStr = String(path);
			if (pathStr === MOCK_REPO_ROOT) return true;
			const mockPaths = Object.keys(mockFileSystemConfig);
			return mockPaths.some((mockPath) => pathStr.startsWith(mockPath) || mockPath.startsWith(pathStr));
		});

		fss = new FileSystemService(MOCK_REPO_ROOT);
		fss.setWorkingDirectory(MOCK_REPO_ROOT);
		mockVcs = sinon.createStubInstance(Git);
		sinon.stub(fss, 'getVcsRoot').returns(MOCK_REPO_ROOT);
		sinon.stub(fss, 'getVcs').returns(mockVcs);
		coder = new SearchReplaceCoder(mockLlms, fss, execCommandStub);
	}

	beforeEach(() => {
		mockLLM = new MockLLM();
		mockLlms = { easy: mockLLM, medium: mockLLM, hard: mockLLM, xhard: mockLLM };
		execCommandStub = sinon.stub();
	});

	afterEach(() => {
		mockLLM.reset();
		mockLLM.assertNoPendingResponses();
		sinon.restore();
		mockFs.restore();
	});

	it('should successfully apply a valid edit on the first attempt and auto-commit', async () => {
		setupMockFs({ '/repo/test.ts': 'hello world' });
		mockLLM.addMessageResponse(SEARCH_BLOCK_VALID);
		mockVcs.addAndCommitFiles.resolves();

		await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

		expect(mockLLM.getCallCount()).to.equal(1);
		const finalContent = await fss.readFile('/repo/test.ts');
		expect(finalContent).to.equal('hello universe\n');
		expect(mockVcs.addAndCommitFiles.calledOnce).to.be.true;
		expect(mockVcs.addAndCommitFiles.firstCall.args[0]).to.deep.equal(['test.ts']);
	});

	it('should commit dirty files before applying edits', async () => {
		setupMockFs({ '/repo/test.ts': 'original dirty content' });
		const block = searchReplaceBlock('test.ts', 'original dirty content', 'clean new content');
		mockLLM
			.addMessageResponse(block) // Main edit
			.addResponse('feat: commit dirty changes'); // Commit message for dirty changes

		mockVcs.isDirty.withArgs('test.ts').resolves(true);
		execCommandStub.withArgs('git diff test.ts').resolves({ stdout: 'diff content', stderr: '', exitCode: 0, command: '' });
		mockVcs.addAndCommitFiles.resolves();

		await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

		expect(mockLLM.getCallCount()).to.equal(2);
		expect(mockVcs.addAndCommitFiles.callCount).to.equal(2);
		expect(mockVcs.addAndCommitFiles.firstCall.args[0]).to.deep.equal(['test.ts']);
		expect(mockVcs.addAndCommitFiles.firstCall.args[1]).to.equal('feat: commit dirty changes');
		expect(mockVcs.addAndCommitFiles.secondCall.args[0]).to.deep.equal(['test.ts']);
		expect(mockVcs.addAndCommitFiles.secondCall.args[1]).to.equal('Applied LLM-generated edits');

		const finalContent = await fss.readFile('/repo/test.ts');
		expect(finalContent).to.equal('clean new content\n');
	});

	it('should reflect on validation failure and succeed on the second attempt', async () => {
		setupMockFs({ '/repo/test.ts': 'hello world' });
		const failingBlock = searchReplaceBlock('non-existent.ts', 'search', 'replace');
		mockLLM.addMessageResponse(failingBlock).addMessageResponse(SEARCH_BLOCK_VALID);

		await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

		const messageCalls = mockLLM.getMessageCalls();
		expect(messageCalls).to.have.lengthOf(2);
		const reflectionMessage = messageCalls[1].messages.at(-2)?.content;
		expect(reflectionMessage).to.contain('File does not exist');
		const finalContent = await fss.readFile('/repo/test.ts');
		expect(finalContent).to.equal('hello universe\n');
	});

	it('should reflect on application failure, attempt to fix, and then succeed', async () => {
		setupMockFs({ '/repo/test.ts': 'original content' });
		const failingBlock = searchReplaceBlock('test.ts', 'bad search', 'new content');
		const correctedBlock = searchReplaceBlock('test.ts', 'original content', 'new content');

		mockLLM
			.addMessageResponse(failingBlock) // Main attempt fails to apply
			.addMessageResponse(correctedBlock); // Fix attempt succeeds

		await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

		expect(mockLLM.getCallCount()).to.equal(2); // Main LLM call + fix LLM call
		const finalContent = await fss.readFile('/repo/test.ts');
		expect(finalContent).to.equal('new content\n');
	});

	it('should throw CoderExhaustedAttemptsError after multiple persistent failures', async () => {
		setupMockFs({ '/repo/test.ts': 'content' });
		const failingBlock = searchReplaceBlock('test.ts', 'non-matching', 'new content');
		for (let i = 0; i < 5; i++) {
			mockLLM.addMessageResponse(failingBlock).addMessageResponse('null'); // Main call fails, fix call fails
		}

		await expect(coder.editFilesToMeetRequirements('test', ['test.ts'], [])).to.be.rejectedWith(CoderExhaustedAttemptsError);
		expect(mockLLM.getCallCount()).to.equal(10); // 5 main calls + 5 fix calls
	});
});
