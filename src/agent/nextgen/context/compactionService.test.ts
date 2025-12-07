import { expect } from 'chai';
import sinon from 'sinon';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { MockLLM, mockLLMs } from '#llm/services/mock-llm';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { NextGenAgentContext } from '../core/types';
import { createAgentWithLoadedTools, createMockAgentContext } from '../test/fixtures';
import { CompactionService } from './compactionService';

describe('CompactionService', () => {
	setupConditionalLoggerOutput();

	let compactionService: CompactionService;
	let mockLLM: MockLLM;

	beforeEach(() => {
		initInMemoryApplicationContext();
		compactionService = new CompactionService();
		mockLLM = mockLLMs().easy as MockLLM;
		mockLLM.reset();
	});

	afterEach(() => {
		mockLLM.reset();
	});

	describe('compact', () => {
		it('should preserve user request verbatim', async () => {
			const agent = createAgentWithHistory();
			const originalPrompt = agent.userPrompt;

			mockLLM.addResponse(
				JSON.stringify({
					summary: 'Completed file search',
					keyDecisions: ['Used grep for search'],
				}),
			);

			await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(agent.userPrompt).to.equal(originalPrompt);
		});

		it('should generate summary of completed work', async () => {
			const agent = createAgentWithHistory();

			mockLLM.addResponse(`<json>
{
  "summary": "Searched codebase and found 3 relevant files for authentication.",
  "keyDecisions": ["Used regex search", "Focused on src/auth directory"]
}
</json>`);

			const result = await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(result.completedWorkSummary).to.include('authentication');
			expect(result.keyDecisions).to.have.lengthOf(2);
		});

		it('should update lastCompactionIteration', async () => {
			const agent = createAgentWithHistory();
			agent.iterations = 10;
			agent.lastCompactionIteration = 0;

			mockLLM.addResponse(
				JSON.stringify({
					summary: 'Work completed',
					keyDecisions: [],
				}),
			);

			await compactionService.compact(agent, 'iteration_threshold', mockLLMs());

			expect(agent.lastCompactionIteration).to.equal(10);
		});

		it('should set compacted context in message stack', async () => {
			const agent = createAgentWithHistory();

			mockLLM.addResponse(
				JSON.stringify({
					summary: 'Implemented feature X',
					keyDecisions: ['Used pattern Y'],
				}),
			);

			await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(agent.messageStack.compactedContext).to.exist;
			expect(agent.messageStack.compactedContext!.content).to.include('compacted_work');
			expect(agent.messageStack.compactedContext!.content).to.include('Implemented feature X');
		});

		it('should trim recent history to configured number of turns', async () => {
			const agent = createAgentWithHistory();
			// Add many messages
			for (let i = 0; i < 20; i++) {
				agent.messageStack.recentHistory.push({ role: 'assistant', content: `Response ${i}` });
				agent.messageStack.recentHistory.push({ role: 'user', content: `Result ${i}` });
			}
			const initialHistoryLength = agent.messageStack.recentHistory.length;

			mockLLM.addResponse(
				JSON.stringify({
					summary: 'Work done',
					keyDecisions: [],
				}),
			);

			// Default is 3 turns preserved
			await compactionService.compact(agent, 'token_threshold', mockLLMs());

			expect(agent.messageStack.recentHistory.length).to.be.lessThan(initialHistoryLength);
			expect(agent.messageStack.recentHistory.length).to.equal(6); // 3 turns * 2 messages
		});

		it('should return iteration range in result', async () => {
			const agent = createAgentWithHistory();
			agent.iterations = 8;
			agent.lastCompactionIteration = 3;

			mockLLM.addResponse(
				JSON.stringify({
					summary: 'Summary',
					keyDecisions: [],
				}),
			);

			const result = await compactionService.compact(agent, 'manual', mockLLMs());

			expect(result.compactedIterationRange.start).to.equal(4);
			expect(result.compactedIterationRange.end).to.equal(8);
		});

		it('should handle LLM errors gracefully with fallback', async () => {
			const agent = createAgentWithHistory();
			agent.iterations = 5;

			mockLLM.rejectNextText(new Error('LLM error'));

			const result = await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			// Should still complete with fallback summary
			expect(result.completedWorkSummary).to.include('Completed iterations');
		});
	});

	describe('learning extraction', () => {
		it('should extract learnings when enabled', async () => {
			const agent = createAgentWithHistory();
			// Need at least 3 successful function calls for extraction to trigger
			agent.functionCallHistory = [
				{ function_name: 'FileSystem_readFile', parameters: { path: 'test.ts' }, stdout: 'file content' },
				{ function_name: 'FileSystem_writeFile', parameters: { path: 'test.ts' }, stdout: 'success' },
				{ function_name: 'FileSystem_listFiles', parameters: { path: '.' }, stdout: 'test.ts, main.ts' },
				{ function_name: 'Git_commit', parameters: { message: 'fix' }, stdout: 'committed' },
			];

			// First call for summary, second for learning extraction
			mockLLM.addResponse(
				JSON.stringify({
					summary: 'Fixed authentication bug',
					keyDecisions: ['Used JWT validation'],
				}),
			);
			mockLLM.addResponse(`<json>
{
  "learnings": [
    {
      "type": "pattern",
      "category": "typescript",
      "content": "Use vi.mock() at module level for mocking",
      "confidence": 0.85,
      "tags": ["testing", "mocking"]
    }
  ]
}
</json>`);

			const result = await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(result.extractedLearnings).to.have.lengthOf(1);
			expect(result.extractedLearnings[0].type).to.equal('pattern');
			expect(result.extractedLearnings[0].confidence).to.equal(0.85);
		});

		it('should filter out low confidence learnings', async () => {
			const agent = createAgentWithHistory();
			agent.functionCallHistory = [
				{ function_name: 'test', parameters: {}, stdout: 'success' },
				{ function_name: 'test2', parameters: {}, stdout: 'success' },
				{ function_name: 'test3', parameters: {}, stdout: 'success' },
			];

			mockLLM.addResponse(JSON.stringify({ summary: 'Done', keyDecisions: [] }));
			mockLLM.addResponse(
				JSON.stringify({
					learnings: [
						{ type: 'pattern', category: 'test', content: 'Low confidence', confidence: 0.5, tags: [] },
						{ type: 'pattern', category: 'test', content: 'High confidence', confidence: 0.9, tags: [] },
					],
				}),
			);

			const result = await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(result.extractedLearnings).to.have.lengthOf(1);
			expect(result.extractedLearnings[0].content).to.equal('High confidence');
		});

		it('should add learnings to agent sessionLearnings', async () => {
			const agent = createAgentWithHistory();
			agent.functionCallHistory = [
				{ function_name: 'test', parameters: {}, stdout: 'success' },
				{ function_name: 'test2', parameters: {}, stdout: 'success' },
				{ function_name: 'test3', parameters: {}, stdout: 'success' },
			];

			mockLLM.addResponse(JSON.stringify({ summary: 'Done', keyDecisions: [] }));
			mockLLM.addResponse(
				JSON.stringify({
					learnings: [{ type: 'pitfall', category: 'async', content: 'Avoid forEach with async', confidence: 0.9, tags: ['async'] }],
				}),
			);

			await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(agent.sessionLearnings).to.have.lengthOf(1);
			expect(agent.sessionLearnings[0].type).to.equal('pitfall');
		});

		it('should include source information in learnings', async () => {
			const agent = createAgentWithHistory();
			agent.agentId = 'test-agent-456';
			agent.userPrompt = 'Fix authentication bug';
			agent.iterations = 5;
			agent.lastCompactionIteration = 0;
			agent.functionCallHistory = [
				{ function_name: 'test', parameters: {}, stdout: 'success' },
				{ function_name: 'test2', parameters: {}, stdout: 'success' },
				{ function_name: 'test3', parameters: {}, stdout: 'success' },
			];

			mockLLM.addResponse(JSON.stringify({ summary: 'Done', keyDecisions: [] }));
			mockLLM.addResponse(
				JSON.stringify({
					learnings: [{ type: 'pattern', category: 'auth', content: 'Learning', confidence: 0.8, tags: [] }],
				}),
			);

			const result = await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(result.extractedLearnings[0].source.agentId).to.equal('test-agent-456');
			expect(result.extractedLearnings[0].source.task).to.include('authentication');
			expect(result.extractedLearnings[0].source.iterationRange).to.deep.equal({ start: 1, end: 5 });
		});
	});

	describe('tool unloading', () => {
		it('should unload tool groups used since last compaction', async () => {
			const agent = createAgentWithLoadedTools(['GitHub', 'Git']);
			agent.toolLoadingState.groupsUsedSinceLastCompaction = new Set(['GitHub', 'Git']);
			addHistoryToAgent(agent);

			mockLLM.addResponse(JSON.stringify({ summary: 'Created PR', keyDecisions: [] }));

			const result = await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(result.unloadedToolGroups).to.include('GitHub');
			expect(result.unloadedToolGroups).to.include('Git');
			expect(agent.toolLoadingState.activeGroups.has('GitHub')).to.be.false;
			expect(agent.toolLoadingState.activeGroups.has('Git')).to.be.false;
		});

		it('should clear groupsUsedSinceLastCompaction after compaction', async () => {
			const agent = createAgentWithLoadedTools(['TypeScript']);
			agent.toolLoadingState.groupsUsedSinceLastCompaction = new Set(['TypeScript']);
			addHistoryToAgent(agent);

			mockLLM.addResponse(JSON.stringify({ summary: 'Ran tests', keyDecisions: [] }));

			await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(agent.toolLoadingState.groupsUsedSinceLastCompaction.size).to.equal(0);
		});

		it('should include tool usage summary in result', async () => {
			const agent = createAgentWithLoadedTools(['GitHub']);
			agent.toolLoadingState.groupsUsedSinceLastCompaction = new Set(['GitHub']);
			addHistoryToAgent(agent);

			mockLLM.addResponse(JSON.stringify({ summary: 'Created issue', keyDecisions: [] }));

			const result = await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(result.toolUsageSummary).to.include('GitHub');
		});

		it('should remove tool schema messages from message stack', async () => {
			const agent = createAgentWithLoadedTools(['GitHub', 'Git']);
			agent.toolLoadingState.groupsUsedSinceLastCompaction = new Set(['GitHub']);
			addHistoryToAgent(agent);

			const initialSchemaCount = agent.messageStack.toolSchemas.length;

			mockLLM.addResponse(JSON.stringify({ summary: 'Work done', keyDecisions: [] }));

			await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			// GitHub should be removed, Git should remain
			expect(agent.messageStack.toolSchemas.length).to.be.lessThan(initialSchemaCount);
		});
	});

	describe('compacted content', () => {
		it('should include summary in compacted content', async () => {
			const agent = createAgentWithHistory();

			mockLLM.addResponse(
				JSON.stringify({
					summary: 'Completed authentication refactor',
					keyDecisions: [],
				}),
			);

			await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(agent.messageStack.compactedContext!.content).to.include('authentication refactor');
		});

		it('should include key decisions in compacted content', async () => {
			const agent = createAgentWithHistory();

			mockLLM.addResponse(
				JSON.stringify({
					summary: 'Done',
					keyDecisions: ['Used JWT over sessions', 'Added rate limiting'],
				}),
			);

			await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(agent.messageStack.compactedContext!.content).to.include('JWT over sessions');
			expect(agent.messageStack.compactedContext!.content).to.include('rate limiting');
		});

		it('should include memory state in compacted content', async () => {
			const agent = createAgentWithHistory();
			agent.memory = { branch_name: 'feature/auth', commit_hash: 'abc123' };

			mockLLM.addResponse(JSON.stringify({ summary: 'Done', keyDecisions: [] }));

			await compactionService.compact(agent, 'subtask_complete', mockLLMs());

			expect(agent.messageStack.compactedContext!.content).to.include('branch_name');
			expect(agent.messageStack.compactedContext!.content).to.include('feature/auth');
		});
	});

	describe('token savings', () => {
		it('should calculate tokens saved', async () => {
			const agent = createAgentWithHistory();
			// Add substantial history
			for (let i = 0; i < 10; i++) {
				agent.messageStack.recentHistory.push({
					role: 'assistant',
					content: 'x'.repeat(1000), // ~250 tokens each
				});
			}

			mockLLM.addResponse(JSON.stringify({ summary: 'Short summary', keyDecisions: [] }));

			const result = await compactionService.compact(agent, 'token_threshold', mockLLMs());

			expect(result.tokensSaved).to.be.greaterThan(0);
		});
	});

	describe('getConfig', () => {
		it('should return copy of config', () => {
			const service = new CompactionService({
				compactionConfig: { iterationThreshold: 10 },
			});

			const config = service.getConfig();

			expect(config.iterationThreshold).to.equal(10);
		});
	});
});

// Helper functions

function createAgentWithHistory(): NextGenAgentContext {
	const agent = createMockAgentContext();
	// Add more than default 3 turns (6 messages) so there's something to trim
	agent.messageStack.recentHistory = [
		{ role: 'assistant', content: 'I will search for files' },
		{ role: 'user', content: 'Found: auth.ts, user.ts' },
		{ role: 'assistant', content: 'Reading auth.ts' },
		{ role: 'user', content: 'File contents...' },
		{ role: 'assistant', content: 'I found the bug' },
		{ role: 'user', content: 'Fix applied' },
		{ role: 'assistant', content: 'Committing changes' },
		{ role: 'user', content: 'Commit successful' },
		{ role: 'assistant', content: 'Creating PR' },
		{ role: 'user', content: 'PR created' },
	];
	agent.iterations = 5;
	agent.lastCompactionIteration = 0;
	return agent;
}

function addHistoryToAgent(agent: NextGenAgentContext): void {
	agent.messageStack.recentHistory = [
		{ role: 'assistant', content: 'Working on task' },
		{ role: 'user', content: 'Result' },
	];
	agent.iterations = 3;
	agent.lastCompactionIteration = 0;
}
