import { expect } from 'chai';
import sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { createAgentWithCompletedSubtask, createAgentWithLargeContext, createAgentWithLoadedTools, createMockAgentContext } from '../test/fixtures';
import { ContextManager } from './contextManager';

describe('ContextManager', () => {
	setupConditionalLoggerOutput();

	let contextManager: ContextManager;

	beforeEach(() => {
		contextManager = new ContextManager({
			maxTokens: 128000,
			responseReserve: 4000,
		});
	});

	describe('buildPrompt', () => {
		it('should include system prompt with cache marker', () => {
			const agent = createMockAgentContext();
			const messages = contextManager.buildPrompt(agent);

			expect(messages[0].role).to.equal('system');
			expect(messages[0].cache).to.equal('ephemeral');
		});

		it('should include repository context with cache marker', () => {
			const agent = createMockAgentContext();
			const messages = contextManager.buildPrompt(agent);

			expect(messages[1].role).to.equal('user');
			expect(messages[1].cache).to.equal('ephemeral');
			expect(messages[1].content).to.include('repository_overview');
		});

		it('should include acknowledgment message before task', () => {
			const agent = createMockAgentContext();
			const messages = contextManager.buildPrompt(agent);

			// Find the acknowledgment message
			const ackMsg = messages.find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('What is the task'));

			expect(ackMsg).to.exist;
			expect(ackMsg!.cache).to.equal('ephemeral');
		});

		it('should include task message with cache marker', () => {
			const agent = createMockAgentContext();
			const messages = contextManager.buildPrompt(agent);

			const taskMsg = messages.find((m) => typeof m.content === 'string' && m.content.includes('<task>'));

			expect(taskMsg).to.exist;
			expect(taskMsg!.cache).to.equal('ephemeral');
		});

		it('should include tool schemas when loaded', () => {
			const agent = createAgentWithLoadedTools(['GitHub', 'Git']);
			const messages = contextManager.buildPrompt(agent);

			const schemaMessages = messages.filter((m) => typeof m.content === 'string' && m.content.includes('loaded_tool_group'));

			expect(schemaMessages).to.have.lengthOf(2);
		});

		it('should include recent history messages', () => {
			const agent = createMockAgentContext();
			agent.messageStack.recentHistory = [
				{ role: 'assistant', content: 'I will search for files' },
				{ role: 'user', content: 'File found: test.ts' },
			];

			const messages = contextManager.buildPrompt(agent);

			expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('search for files'))).to.be.true;
			expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('File found'))).to.be.true;
		});

		it('should include compacted context when present', () => {
			const agent = createMockAgentContext();
			agent.messageStack.compactedContext = {
				role: 'user',
				content: '<compacted_work iterations="1-5">\nCompleted file search\n</compacted_work>',
				cache: 'ephemeral',
			};

			const messages = contextManager.buildPrompt(agent);

			const compactedMsg = messages.find((m) => typeof m.content === 'string' && m.content.includes('compacted_work'));

			expect(compactedMsg).to.exist;
			expect(compactedMsg!.cache).to.equal('ephemeral');
		});

		it('should include current iteration when set', () => {
			const agent = createMockAgentContext();
			agent.messageStack.currentIteration = {
				role: 'user',
				content: 'Current iteration prompt',
			};

			const messages = contextManager.buildPrompt(agent);
			const lastMsg = messages[messages.length - 1];

			expect(lastMsg.content).to.equal('Current iteration prompt');
			expect(lastMsg.cache).to.be.undefined; // Current iteration should never be cached
		});

		it('should prune ephemeral cache markers when exceeding limit', () => {
			const agent = createMockAgentContext();

			// Add many messages with ephemeral cache
			for (let i = 0; i < 10; i++) {
				agent.messageStack.recentHistory.push({
					role: 'assistant',
					content: `Response ${i}`,
					cache: 'ephemeral',
				});
			}

			const messages = contextManager.buildPrompt(agent);
			const ephemeralCount = messages.filter((m) => m.cache === 'ephemeral').length;

			// Should have at most maxEphemeralMarkers (default 5)
			expect(ephemeralCount).to.be.at.most(5);
		});
	});

	describe('calculateTokenBudget', () => {
		it('should calculate token budget correctly', async () => {
			const agent = createMockAgentContext();
			const mockLLM = {
				countTokens: sinon.stub().resolves(100),
			} as any;

			const budget = await contextManager.calculateTokenBudget(agent, mockLLM);

			expect(budget.maxTokens).to.equal(128000);
			expect(budget.responseReserve).to.equal(4000);
			expect(budget.currentUsed).to.be.a('number');
			expect(budget.available).to.be.a('number');
			expect(budget.available).to.be.lessThan(budget.maxTokens);
		});

		it('should account for tool schema tokens', async () => {
			const agentWithTools = createAgentWithLoadedTools(['GitHub', 'Git']);
			const agentWithoutTools = createMockAgentContext();

			const mockLLM = {
				countTokens: sinon.stub().callsFake(async (text: string) => Math.ceil(text.length / 4)),
			} as any;

			const budgetWithTools = await contextManager.calculateTokenBudget(agentWithTools, mockLLM);
			const budgetWithoutTools = await contextManager.calculateTokenBudget(agentWithoutTools, mockLLM);

			expect(budgetWithTools.toolSchemaTokens).to.be.greaterThan(budgetWithoutTools.toolSchemaTokens);
		});

		it('should calculate available tokens correctly', async () => {
			const agent = createMockAgentContext();
			const mockLLM = {
				countTokens: sinon.stub().resolves(1000),
			} as any;

			const budget = await contextManager.calculateTokenBudget(agent, mockLLM);

			expect(budget.available).to.equal(budget.maxTokens - budget.currentUsed - budget.responseReserve);
		});
	});

	describe('shouldCompact', () => {
		it('should trigger on sub-task completion marker', async () => {
			const agent = createAgentWithCompletedSubtask();
			const mockLLM = { countTokens: sinon.stub().resolves(100) } as any;

			const result = await contextManager.shouldCompact(agent, mockLLM);

			expect(result.should).to.be.true;
			expect(result.trigger).to.equal('subtask_complete');
		});

		it('should trigger on token threshold', async () => {
			const agent = createMockAgentContext();
			// Set up so we're over the threshold
			const mockLLM = {
				countTokens: sinon.stub().resolves(50000), // Large token count per section
			} as any;

			// Use a manager with lower max tokens to trigger threshold
			const smallManager = new ContextManager({
				maxTokens: 10000,
				compactionConfig: { tokenThresholdPercent: 0.5 },
			});

			const result = await smallManager.shouldCompact(agent, mockLLM);

			expect(result.should).to.be.true;
			expect(result.trigger).to.equal('token_threshold');
		});

		it('should trigger on iteration threshold', async () => {
			const agent = createMockAgentContext();
			agent.iterations = 10;
			agent.lastCompactionIteration = 0;

			const mockLLM = { countTokens: sinon.stub().resolves(100) } as any;

			const managerWithLowThreshold = new ContextManager({
				compactionConfig: { iterationThreshold: 5 },
			});

			const result = await managerWithLowThreshold.shouldCompact(agent, mockLLM);

			expect(result.should).to.be.true;
			expect(result.trigger).to.equal('iteration_threshold');
		});

		it('should not trigger when within all thresholds', async () => {
			const agent = createMockAgentContext();
			agent.iterations = 2;
			agent.lastCompactionIteration = 0;

			const mockLLM = { countTokens: sinon.stub().resolves(100) } as any;

			const result = await contextManager.shouldCompact(agent, mockLLM);

			expect(result.should).to.be.false;
			expect(result.trigger).to.be.undefined;
		});
	});

	describe('addToHistory', () => {
		it('should append message to recent history', () => {
			const agent = createMockAgentContext();
			const initialLength = agent.messageStack.recentHistory.length;

			contextManager.addToHistory(agent, { role: 'assistant', content: 'Test response' });

			expect(agent.messageStack.recentHistory.length).to.equal(initialLength + 1);
			expect(agent.messageStack.recentHistory[initialLength].content).to.equal('Test response');
		});
	});

	describe('setCurrentIteration / clearCurrentIteration', () => {
		it('should set current iteration message', () => {
			const agent = createMockAgentContext();
			const message = { role: 'user' as const, content: 'Current prompt' };

			contextManager.setCurrentIteration(agent, message);

			expect(agent.messageStack.currentIteration).to.deep.equal(message);
		});

		it('should clear current iteration message', () => {
			const agent = createMockAgentContext();
			agent.messageStack.currentIteration = { role: 'user', content: 'Some content' };

			contextManager.clearCurrentIteration(agent);

			expect(agent.messageStack.currentIteration).to.be.undefined;
		});
	});

	describe('addToolSchema / removeToolSchemas', () => {
		it('should add tool schema message', () => {
			const agent = createMockAgentContext();
			const schemaContent = '## GitHub Tools\n- createIssue\n- createMergeRequest';

			contextManager.addToolSchema(agent, 'GitHub', schemaContent);

			expect(agent.messageStack.toolSchemas.length).to.equal(1);
			expect(agent.messageStack.toolSchemas[0].content).to.include('loaded_tool_group name="GitHub"');
			expect(agent.toolLoadingState.activeGroups.has('GitHub')).to.be.true;
		});

		it('should track tool group in groupsUsedSinceLastCompaction', () => {
			const agent = createMockAgentContext();

			contextManager.addToolSchema(agent, 'Git', 'Git tools content');

			expect(agent.toolLoadingState.groupsUsedSinceLastCompaction.has('Git')).to.be.true;
		});

		it('should remove specified tool schemas', () => {
			const agent = createAgentWithLoadedTools(['GitHub', 'Git', 'TypeScript']);

			contextManager.removeToolSchemas(agent, ['GitHub', 'Git']);

			expect(agent.messageStack.toolSchemas.length).to.equal(1);
			expect(agent.toolLoadingState.activeGroups.has('GitHub')).to.be.false;
			expect(agent.toolLoadingState.activeGroups.has('Git')).to.be.false;
			expect(agent.toolLoadingState.activeGroups.has('TypeScript')).to.be.true;
		});
	});

	describe('setCompactedContext', () => {
		it('should set compacted context with iteration range', () => {
			const agent = createMockAgentContext();
			const summary = 'Completed file search and found 3 matches';
			const range = { start: 1, end: 5 };

			contextManager.setCompactedContext(agent, summary, range);

			expect(agent.messageStack.compactedContext).to.exist;
			expect(agent.messageStack.compactedContext!.content).to.include('iterations="1-5"');
			expect(agent.messageStack.compactedContext!.content).to.include(summary);
			expect(agent.messageStack.compactedContext!.cache).to.equal('ephemeral');
		});

		it('should add summary to compactedSummaries array', () => {
			const agent = createMockAgentContext();
			const summary = 'First compaction summary';

			contextManager.setCompactedContext(agent, summary, { start: 1, end: 3 });

			expect(agent.compactedSummaries).to.include(summary);
		});
	});

	describe('trimRecentHistory', () => {
		it('should trim history to specified number of turns', () => {
			const agent = createMockAgentContext();
			// Add 10 message pairs (20 messages)
			for (let i = 0; i < 10; i++) {
				agent.messageStack.recentHistory.push({ role: 'assistant', content: `Response ${i}` });
				agent.messageStack.recentHistory.push({ role: 'user', content: `Result ${i}` });
			}

			const trimmed = contextManager.trimRecentHistory(agent, 3);

			// Should preserve 3 turns (6 messages)
			expect(agent.messageStack.recentHistory.length).to.equal(6);
			// Should return trimmed messages
			expect(trimmed.length).to.equal(14);
		});

		it('should return empty array if nothing to trim', () => {
			const agent = createMockAgentContext();
			agent.messageStack.recentHistory = [
				{ role: 'assistant', content: 'Response' },
				{ role: 'user', content: 'Result' },
			];

			const trimmed = contextManager.trimRecentHistory(agent, 3);

			expect(trimmed).to.have.lengthOf(0);
			expect(agent.messageStack.recentHistory.length).to.equal(2);
		});
	});

	describe('initializeMessageStack', () => {
		it('should create properly structured message stack', () => {
			const stack = contextManager.initializeMessageStack('System prompt content', '<repository_overview>Repo info</repository_overview>', 'Fix the bug');

			expect(stack.systemMessage.role).to.equal('system');
			expect(stack.systemMessage.content).to.equal('System prompt content');
			expect(stack.systemMessage.cache).to.equal('ephemeral');

			expect(stack.repositoryContext.role).to.equal('user');
			expect(stack.repositoryContext.content).to.include('repository_overview');
			expect(stack.repositoryContext.cache).to.equal('ephemeral');

			expect(stack.taskMessage.role).to.equal('user');
			expect(stack.taskMessage.content).to.include('<task>');
			expect(stack.taskMessage.content).to.include('Fix the bug');
			expect(stack.taskMessage.cache).to.equal('ephemeral');

			expect(stack.toolSchemas).to.be.an('array').that.is.empty;
			expect(stack.recentHistory).to.be.an('array').that.is.empty;
		});
	});

	describe('getCompactionConfig', () => {
		it('should return copy of compaction config', () => {
			const config = contextManager.getCompactionConfig();

			expect(config.tokenThresholdPercent).to.equal(0.8);
			expect(config.iterationThreshold).to.equal(5);
			expect(config.extractLearnings).to.be.true;
		});

		it('should use custom config when provided', () => {
			const customManager = new ContextManager({
				compactionConfig: {
					tokenThresholdPercent: 0.7,
					iterationThreshold: 3,
				},
			});

			const config = customManager.getCompactionConfig();

			expect(config.tokenThresholdPercent).to.equal(0.7);
			expect(config.iterationThreshold).to.equal(3);
		});
	});
});
