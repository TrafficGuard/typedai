import { expect } from 'chai';
import mock from 'mock-fs';
import sinon from 'sinon';
import { setFileSystemOverride } from '#agent/agentContextLocalStorage';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { logger } from '#o11y/logger';
import type { SelectedFile } from '#shared/files/files.model';
import type { UserContentExt } from '#shared/llm/llm.model';
import * as repoOverviewModule from '#swe/index/repoIndexDocBuilder';
import * as repoMapModule from '#swe/index/repositoryMap';
import type { ProjectInfo } from '#swe/projectDetection';
import * as projectDetectionModule from '#swe/projectDetection';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { mockLLM, mockLLMs } from '../../llm/services/mock-llm';
import { selectFilesAgent } from './selectFilesAgentWithSearch';

import type { AgentLLMs } from '#shared/agent/agent.model';
import { MINIMAL_AI_INFO } from '../projectDetection';

describe('selectFilesAgentWithSearch', () => {
	setupConditionalLoggerOutput();

	const sandbox = sinon.createSandbox();

	let fsOverride: FileSystemService;
	let searchExtractsStub: sinon.SinonStub;
	let searchFilesStub: sinon.SinonStub;
	let llmSet: AgentLLMs;

	beforeEach(() => {
		mockLLM.reset();

		llmSet = mockLLMs();

		mock({
			'/repo': {
				'.git': {},
				'.gitignore': '',
				'.typedai.json': MINIMAL_AI_INFO,
				'a.txt': 'alpha content',
				'b.txt': 'beta content',
			},
		});

		fsOverride = new FileSystemService('/repo');
		sandbox.stub(fsOverride, 'getWorkingDirectory').returns('/repo');
		sandbox.stub(fsOverride, 'getVcsRoot').returns('/repo');

		searchExtractsStub = sandbox.stub(fsOverride, 'searchExtractsMatchingContents').resolves('a.txt: alpha match');
		searchFilesStub = sandbox.stub(fsOverride, 'searchFilesMatchingContents').resolves('a.txt: 1');

		setFileSystemOverride(fsOverride);
	});

	afterEach(() => {
		mockLLM.assertNoPendingResponses();
		setFileSystemOverride(null);
		mock.restore();
		sandbox.restore();
	});

	describe('selectFilesAgent', () => {
		it('performs search and continues when no filesToInspect and no pending', async () => {
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":[]}</json>') // initial
				.addMessageResponse('<json>{"search":"TODO","keepFiles":[],"ignoreFiles":[]}</json>') // iteration 1
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"a.txt","reason":"match"}]}</json>'); // iteration 2

			const files = await selectFilesAgent('Find alpha', {}, llmSet);

			expect(files).to.deep.equal([{ filePath: 'a.txt', reason: 'match' }]);

			const calls = mockLLM.getMessageCalls();
			expect(calls.length).to.be.greaterThan(2);

			// After the search iteration, the next call (iteration 2) should include the search results in prior messages
			const iter2Call = calls[2]!;
			const iter2Msgs = iter2Call.messages;

			const hasSearchResults = iter2Msgs.some(
				(m) => m.role === 'user' && typeof m.content === 'string' && (m.content as string).includes('<search_results regex="TODO"'),
			);
			expect(hasSearchResults).to.equal(true);

			// Ephemeral messages are pruned consistently (<= 4)
			const ephemeralCount = iter2Msgs.filter((m: any) => m.cache === 'ephemeral').length;
			expect(ephemeralCount).to.be.at.most(4);
		});

		it('reminds and escalates when pending not resolved', async () => {
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":["a.txt"]}</json>') // initial: request inspection
				.addMessageResponse('<json>{}</json>') // iteration 1: no decisions, triggers reminder + escalate
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"a.txt","reason":"kept"}]}</json>'); // iteration 2: resolve

			const files = await selectFilesAgent('Need a.txt', {}, llmSet);
			expect(files).to.deep.equal([{ filePath: 'a.txt', reason: 'kept' }]);

			const calls = mockLLM.getMessageCalls();
			// After iteration 1 (which had no decisions), iteration 2 should include the reminder in prior messages
			const iter2Msgs = calls[2]!.messages;
			const hasReminder = iter2Msgs.some(
				(m) => m.role === 'user' && typeof m.content === 'string' && (m.content as string).includes('You have not resolved the following pending files'),
			);
			expect(hasReminder).to.equal(true);
		});

		it('reports invalid inspect paths in next-iteration prompt', async () => {
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":["not-exists.txt"]}</json>') // initial: invalid path
				.addMessageResponse('<json>{"search":"ANY"}</json>') // iteration 1: trigger search to continue
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"a.txt","reason":"found"}]}</json>'); // iteration 2

			const files = await selectFilesAgent('Find file that matches', {}, llmSet);
			expect(files).to.deep.equal([{ filePath: 'a.txt', reason: 'found' }]);

			const calls = mockLLM.getMessageCalls();
			const iter1Call = calls[1]!;
			const userMessages = iter1Call.messages.filter((m) => m.role === 'user');
			expect(userMessages.length).to.be.greaterThan(0);
			const iter1UserPrompt = userMessages[userMessages.length - 1]!;
			expect(typeof iter1UserPrompt.content).to.equal('string');
			expect(iter1UserPrompt.content as string).to.include('were invalid or unreadable and have been ignored');
			expect(iter1UserPrompt.content as string).to.include('not-exists.txt');
		});
		it('assigns default reason when keepFiles are provided as strings', async () => {
			mockLLM.addMessageResponse('<json>{"inspectFiles":["a.txt"]}</json>').addMessageResponse('<json>{"keepFiles":["a.txt"]}</json>');

			const files = await selectFilesAgent('String keep reason', {}, llmSet);

			expect(files).to.deep.equal([{ filePath: 'a.txt', reason: 'Reason not provided by LLM.' }]);
		});

		it('includes search errors in subsequent prompts when search fails', async () => {
			searchExtractsStub.rejects(new Error('Search failed'));

			mockLLM
				.addMessageResponse('<json>{"inspectFiles":[]}</json>')
				.addMessageResponse('<json>{"search":"FAIL","keepFiles":[],"ignoreFiles":[]}</json>')
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"a.txt","reason":"found"}]}</json>');

			const files = await selectFilesAgent('Handle search errors', {}, llmSet);
			expect(files).to.deep.equal([{ filePath: 'a.txt', reason: 'found' }]);

			expect(searchExtractsStub.calledOnceWithExactly('FAIL', 1)).to.equal(true);
			expect(searchFilesStub.called).to.equal(false);

			const iteration2Call = mockLLM.getMessageCalls().find((call) => call.options?.id === 'Select Files iteration 2');
			expect(iteration2Call).to.not.be.undefined;

			const errorMessage = iteration2Call!.messages.find(
				(m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('<search_error regex="FAIL"'),
			);
			expect(errorMessage).to.not.be.undefined;
		});

		it('truncates large search results and notifies the model', async () => {
			const large = 'X'.repeat(40000);
			searchExtractsStub.callsFake(async () => large);
			searchFilesStub.callsFake(async () => 'Y'.repeat(40000));

			mockLLM
				.addMessageResponse('<json>{"inspectFiles":[]}</json>')
				.addMessageResponse('<json>{"search":"TODO","keepFiles":[],"ignoreFiles":[]}</json>')
				.addMessageResponse('<json>{"keepFiles":[{"filePath":"a.txt","reason":"found"}]}</json>');

			const files = await selectFilesAgent('Truncate search', {}, llmSet);
			expect(files).to.deep.equal([{ filePath: 'a.txt', reason: 'found' }]);

			expect(searchExtractsStub.callCount).to.equal(2);
			expect(searchFilesStub.calledOnceWithExactly('TODO')).to.equal(true);

			const iteration2Call = mockLLM.getMessageCalls().find((call) => call.options?.id === 'Select Files iteration 2');
			expect(iteration2Call).to.not.be.undefined;

			const truncatedMessage = iteration2Call!.messages.find(
				(m) =>
					m.role === 'user' &&
					typeof m.content === 'string' &&
					m.content.includes('truncated="true"') &&
					m.content.includes('Note: Search results were too large'),
			);
			expect(truncatedMessage).to.not.be.undefined;
		});

		it('throws when no files are ultimately selected', async () => {
			mockLLM
				.addMessageResponse('<json>{"inspectFiles":["a.txt"]}</json>')
				.addMessageResponse('<json>{"ignoreFiles":[{"filePath":"a.txt","reason":"not needed"}]}</json>');

			try {
				await selectFilesAgent('No selection', {}, llmSet);
				expect.fail('Expected selectFilesAgent to throw');
			} catch (error) {
				expect((error as Error).message).to.equal('No files were selected to fulfill the requirements.');
			}
		});
	});
});
