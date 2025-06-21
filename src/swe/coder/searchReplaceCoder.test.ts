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
import { EditApplier } from './editApplier';
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

describe.only('SearchReplaceCoder: Reflection Logic', () => {
	setupConditionalLoggerOutput();

	let coder: SearchReplaceCoder;
	let mockLlms: AgentLLMs;
	let mockLLM: MockLLM;
	let fss: IFileSystemService;
	let mockVcs: sinon.SinonStubbedInstance<VersionControlSystem>;

	// Helper function to set up mock file system and FileSystemService
	function setupMockFs(mockFileSystemConfig: any): void {
		mockFileSystemConfig[`${MOCK_REPO_ROOT}/.gitignore`] = '';
		mockFs(mockFileSystemConfig);

		// Stub existsSync to work with the mocked file system
		const existsSyncStub = sinon.stub(require('node:fs'), 'existsSync');
		existsSyncStub.callsFake((path: unknown) => {
			const pathStr = String(path);
			// Return true for the mock repo root and any paths that should exist
			if (pathStr === MOCK_REPO_ROOT) return true;
			// For other paths, check if they exist in the mock config
			const mockPaths = Object.keys(mockFileSystemConfig);
			return mockPaths.some((mockPath) => pathStr.startsWith(mockPath) || mockPath.startsWith(pathStr));
		});

		fss = new FileSystemService(MOCK_REPO_ROOT);
		fss.setWorkingDirectory(MOCK_REPO_ROOT);
		mockVcs = sinon.createStubInstance(Git);
		sinon.stub(fss, 'getVcsRoot').returns(MOCK_REPO_ROOT);
		sinon.stub(fss, 'getVcs').returns(mockVcs);
		coder = new SearchReplaceCoder(mockLlms, fss);
	}

	beforeEach(() => {
		mockLLM = new MockLLM();
		mockLlms = { easy: mockLLM, medium: mockLLM, hard: mockLLM, xhard: mockLLM };
	});

	afterEach(() => {
		mockLLM.reset();
		mockLLM.assertNoPendingResponses(); // Ensures no leftover responses
		sinon.restore();
		mockFs.restore();
	});

	describe('on Initial LLM Response Issues', () => {
		it('should reflect with a specific message when the LLM returns an empty response', async () => {
			setupMockFs({ '/repo/test.ts': 'hello world' });

			mockLLM
				.addMessageResponse('') // First call returns empty
				.addMessageResponse(SEARCH_BLOCK_VALID); // Second call (after reflection) succeeds

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			const messageCalls = mockLLM.getMessageCalls();
			expect(messageCalls).to.have.lengthOf(2);
			const reflectionMessage = messageCalls[1].messages.at(-1)?.content;
			expect(reflectionMessage).to.contain('No edit blocks or actionable requests');
		});

		it('should reflect if the LLM provides no edit blocks and no meta-requests', async () => {
			setupMockFs({ '/repo/test.ts': 'hello world' });

			mockLLM
				.addMessageResponse('Sure, I can do that.') // First call has no blocks
				.addMessageResponse(SEARCH_BLOCK_VALID); // Second call succeeds

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			const messageCalls = mockLLM.getMessageCalls();
			expect(messageCalls).to.have.lengthOf(2);
			const reflectionMessage = messageCalls[1].messages.at(-1)?.content;
			expect(reflectionMessage).to.contain('No edit blocks or actionable requests');
		});
	});

	describe('on Validation Failures', () => {
		it('should reflect on a file path that does not exist', async () => {
			setupMockFs({ '/repo/existing.ts': 'file content', '/repo/test.ts': 'hello world' });

			const editBlock = searchReplaceBlock('non-existent.ts', 'original', 'updated');
			mockLLM
				.addMessageResponse(editBlock) // First attempt fails validation
				.addMessageResponse(SEARCH_BLOCK_VALID); // Second attempt succeeds
			const applierSpy = sinon.spy(EditApplier.prototype, 'apply');

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			expect(mockLLM.getMessageCalls()).to.have.lengthOf(2);
			const reflection = mockLLM.getMessageCalls()[1].messages.at(-1)?.content;
			expect(reflection).to.contain('File does not exist, but the SEARCH block is not empty.');
			expect(applierSpy.called).to.be.false;
		});

		it('should reflect on a file path that uses a module alias like # or @', async () => {
			setupMockFs({ '/repo/test.ts': 'hello world' });

			const editBlock = searchReplaceBlock('#services/my-service.ts', 'original', 'updated');
			mockLLM.addMessageResponse(editBlock).addMessageResponse(SEARCH_BLOCK_VALID);

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			const reflection = mockLLM.getMessageCalls()[1].messages.at(-1)?.content;
			expect(reflection).to.contain("should not begin with '#'. It seems like you're writing to a module alias");
		});

		it('should reflect with all issues if multiple validation rules fail', async () => {
			setupMockFs({ '/repo/test.ts': 'hello world' });
			const editBlock1 = searchReplaceBlock('#services/my-service.ts', 'original', 'updated');
			const editBlock2 = searchReplaceBlock('non-existent.ts', 'original', 'updated');
			const editBlocks = `${editBlock1}\n\n${editBlock2}`;

			mockLLM.addMessageResponse(editBlocks).addMessageResponse(SEARCH_BLOCK_VALID);

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			const reflection = mockLLM.getMessageCalls()[1].messages.at(-1)?.content;
			expect(reflection).to.contain("should not begin with '#'");
			expect(reflection).to.contain('File does not exist');
		});
	});

	describe('on Edit Application Failures', () => {
		it('should reflect when an edit fails to apply due to a non-matching SEARCH block', async () => {
			setupMockFs({ '/repo/test.ts': 'hello world' });

			const failingBlock = searchReplaceBlock('test.ts', 'goodbye world', 'new content');
			mockLLM
				.addMessageResponse(failingBlock) // Main attempt
				.addResponse('null') // Fix attempt fails
				.addMessageResponse(SEARCH_BLOCK_VALID); // Reflection attempt

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			expect(mockLLM.getCallCount()).to.equal(3); // Main (msg) + fix (txt) + reflection (msg)
			const reflection = mockLLM.getMessageCalls()[1].messages.at(-1)?.content;
			expect(reflection).to.contain('This SEARCH block failed to exactly match lines in test.ts');
		});

		it('should reflect with a summary of both passed and failed edits', async () => {
			setupMockFs({
				'/repo/pass.ts': 'pass content',
				'/repo/fail.ts': 'fail content',
			});
			const passBlock = searchReplaceBlock('pass.ts', 'pass content', 'new pass content');
			const failBlock = searchReplaceBlock('fail.ts', 'fail content', 'new fail content');
			const editBlocks = `${passBlock}\n\n${failBlock}`;

			mockLLM
				.addMessageResponse(editBlocks)
				.addResponse('null') // Fail fix attempt
				.addMessageResponse(SEARCH_BLOCK_VALID); // Reflection attempt

			await coder.editFilesToMeetRequirements('test', ['pass.ts', 'fail.ts'], []);

			const reflection = mockLLM.getMessageCalls()[1].messages.at(-1)?.content;
			expect(reflection).to.contain('1 SEARCH/REPLACE blocks failed to match!');
			expect(reflection).to.contain('The other 1 SEARCH/REPLACE block were applied successfully.');
		});
	});

	describe('on Edit Fixing and Re-application Logic', () => {
		it('should attempt to fix a failed block and NOT reflect if the fix and re-application succeed', async () => {
			setupMockFs({ '/repo/test.ts': 'original content' });
			// use searchReplaceBlock
			const failingBlock = searchReplaceBlock('test.ts', 'bad search', 'new content');
			const correctedBlock = searchReplaceBlock('test.ts', 'original content', 'new content');

			mockLLM.addMessageResponse(failingBlock).addResponse(correctedBlock); // Stub tryFixSearchBlock to succeed

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			expect(mockLLM.getMessageCalls()).to.have.lengthOf(1); // Main attempt only
			expect(mockLLM.getCallCount()).to.equal(2); // Main (msg) + fix (txt)
			const finalContent = await fss.readFile('/repo/test.ts');
			expect(finalContent).to.contain('new content');
		});

		it('should reflect with remaining failures if the corrected block also fails to apply', async () => {
			setupMockFs({ '/repo/test.ts': 'original content' });
			const failingBlock = searchReplaceBlock('test.ts', 'bad search', 'new content');
			const correctedBlock = searchReplaceBlock('test.ts', 'original content', 'new content');
			mockLLM.addMessageResponse(failingBlock).addResponse(correctedBlock); // Stub tryFixSearchBlock to succeed

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			expect(mockLLM.getMessageCalls()).to.have.lengthOf(1); // Main attempt only
			expect(mockLLM.getCallCount()).to.equal(2); // Main (msg) + fix (txt)
			const finalContent = await fss.readFile('/repo/test.ts');
			expect(finalContent).to.contain('new content');
		});

		it('should reflect with remaining failures if the corrected block also fails to apply', async () => {
			setupMockFs({ '/repo/test.ts': 'original content' });
			const failingBlock = searchReplaceBlock('test.ts', 'bad search', 'new content');
			const stillFailingBlock = searchReplaceBlock('test.ts', 'still bad search', 'new content');
			mockLLM
				.addMessageResponse(failingBlock)
				.addResponse(stillFailingBlock) // Fix returns another bad block
				.addMessageResponse(SEARCH_BLOCK_VALID);

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			const messageCalls = mockLLM.getMessageCalls();
			expect(messageCalls).to.have.lengthOf(2); // Main attempt + reflection
			const reflection = messageCalls[1].messages.at(-1)?.content;
			expect(reflection).to.contain('This SEARCH block failed to exactly match lines in test.ts');
		});
	});

	describe('on Context and State Failures', () => {
		it('should reflect if a file was modified externally before edits are applied', async () => {
			setupMockFs({ '/repo/test.ts': 'initial content' });
			// Stub readFile to simulate modification after prompt build
			const readFileStub = sinon.stub(fss, 'readFile');
			readFileStub.callThrough();
			readFileStub.withArgs('/repo/test.ts').onFirstCall().resolves('initial content'); // For prompt build
			// For external change check and all subsequent reads, return modified content
			readFileStub.withArgs('/repo/test.ts').resolves('modified content');

			mockLLM
				.addMessageResponse(SEARCH_BLOCK_VALID.replace('hello world', 'initial content'))
				.addMessageResponse(SEARCH_BLOCK_VALID.replace('hello world', 'modified content'));

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			const messageCalls = mockLLM.getMessageCalls();
			expect(messageCalls).to.have.lengthOf(2);
			const reflection = messageCalls[1].messages.at(-1)?.content;
			expect(reflection).to.contain('were modified after the edit blocks were generated');
		});

		it('should reflect if a required dirty commit fails', async () => {
			setupMockFs({ '/repo/dirty.ts': 'content' });
			mockVcs.isDirty.withArgs('dirty.ts').resolves(true);
			mockVcs.addAndCommitFiles.rejects(new Error('Commit failed'));
			mockLLM.addMessageResponse('dirty.ts\n<<<<<<< SEARCH\ncontent\n=======\nnew\n>>>>>>> REPLACE').addMessageResponse(SEARCH_BLOCK_VALID);

			await coder.editFilesToMeetRequirements('test', ['dirty.ts'], [], true, true);

			const reflection = mockLLM.getMessageCalls()[1].messages.at(-1)?.content;
			expect(reflection).to.contain('Failed to commit uncommitted changes');
		});
	});

	describe('on Meta-Requests (Files, Queries, Packages)', () => {
		it('should reflect to confirm file requests and ask to proceed when no edit blocks are present', async () => {
			setupMockFs({ '/repo/test.ts': 'hello world' });
			const fileRequest = `<add-files-json>{"files":[{"filePath":"src/utils.ts","reason":"..."}]}</add-files-json>`;
			mockLLM.addMessageResponse(fileRequest).addMessageResponse(SEARCH_BLOCK_VALID);

			await coder.editFilesToMeetRequirements('test', [], []);

			const reflection = mockLLM.getMessageCalls()[1].messages.at(-1)?.content;
			expect(reflection).to.contain('I have added the 1 file(s) you requested');
			expect(reflection).to.contain('Please proceed with the edits');
		});

		it('should process edits and log a warning if meta-requests and edit blocks are in the same response', async () => {
			setupMockFs({ '/repo/test.ts': 'hello world' });
			const response = `<add-files-json>{"files":[]}</add-files-json>\n${SEARCH_BLOCK_VALID}`;
			mockLLM.addMessageResponse(response);

			await coder.editFilesToMeetRequirements('test', ['test.ts'], []);

			expect(mockLLM.getMessageCalls()).to.have.lengthOf(1);
			const finalContent = await fss.readFile('/repo/test.ts');
			expect(finalContent).to.contain('hello universe');
		});
	});

	describe('on Attempt Exhaustion', () => {
		it('should throw CoderExhaustedAttemptsError when max attempts are reached with persistent failures', async () => {
			setupMockFs({ '/repo/test.ts': 'content' });
			const failingBlock = searchReplaceBlock('test.ts', 'non-matching', 'new content');
			// Always respond with an invalid block, and always fail to fix it
			for (let i = 0; i < 5; i++) {
				// MAX_ATTEMPTS is 5
				mockLLM.addMessageResponse(failingBlock).addResponse('null'); // Fix always fails
			}

			let error: Error | null = null;
			try {
				await coder.editFilesToMeetRequirements('test', ['test.ts'], []);
			} catch (e) {
				error = e as Error;
			}

			expect(error).to.be.instanceOf(CoderExhaustedAttemptsError);
			// 5 attempts = 5 message calls (initial attempt) + 5 text calls (fix attempt)
			expect(mockLLM.getCallCount()).to.equal(10);
			if (error instanceof CoderExhaustedAttemptsError) {
				expect(error.lastReflection).to.be.a('string');
				expect(error.lastReflection).to.contain('This SEARCH block failed to exactly match lines in test.ts');
			}
		});
	});
});
