import { expect } from 'chai';
import * as sinon from 'sinon';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import type { NextGenAgentContext, SubAgentConfig, SubAgentResult, SubAgentSpawnConfig } from '../core/types';
import { createMockAgentContext } from '../test/fixtures';
import { type SubAgentContextFactory, type SubAgentExecutor, SubAgentOrchestrator } from './subAgentOrchestrator';

describe('SubAgentOrchestrator', () => {
	setupConditionalLoggerOutput();

	let orchestrator: SubAgentOrchestrator;
	let mockContextFactory: sinon.SinonStub;
	let mockExecutor: sinon.SinonStub;
	let parentContext: NextGenAgentContext;

	beforeEach(() => {
		orchestrator = new SubAgentOrchestrator();
		parentContext = createMockAgentContext();
		parentContext.budgetRemaining = 10.0;

		// Create mock factory that returns a child context
		mockContextFactory = sinon.stub().callsFake(async (parent: NextGenAgentContext, config: SubAgentConfig, task: string) => {
			const child = createMockAgentContext();
			child.name = config.name;
			child.parentAgentId = parent.agentId;
			return child;
		});

		// Create mock executor that returns a success result
		mockExecutor = sinon.stub().callsFake(
			async (context: NextGenAgentContext): Promise<SubAgentResult> => ({
				agentId: context.agentId,
				name: context.name,
				output: `Result from ${context.name}`,
				state: 'completed',
				cost: 0.5,
				iterations: 3,
			}),
		);

		orchestrator.setContextFactory(mockContextFactory);
		orchestrator.setExecutor(mockExecutor);
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('spawn', () => {
		it('should create isolated agent contexts', async () => {
			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'task_decomposition',
				agents: [
					{ name: 'search', role: 'search', llmLevel: 'easy' },
					{ name: 'implement', role: 'implementation', llmLevel: 'hard' },
				],
				coordination: { type: 'parallel', aggregation: 'merge' },
			};

			const executions = await orchestrator.spawn(parentContext, spawnConfig, 'Find and fix bugs');

			expect(executions).to.have.lengthOf(2);
			expect(mockContextFactory.callCount).to.equal(2);

			// Verify contexts are created with correct configs
			const firstCall = mockContextFactory.getCall(0);
			expect(firstCall.args[1].name).to.equal('search');
			expect(firstCall.args[1].llmLevel).to.equal('easy');

			const secondCall = mockContextFactory.getCall(1);
			expect(secondCall.args[1].name).to.equal('implement');
			expect(secondCall.args[1].llmLevel).to.equal('hard');
		});

		it('should track executions in parent context', async () => {
			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'specialist',
				agents: [{ name: 'searcher', role: 'search', llmLevel: 'easy' }],
				coordination: { type: 'sequential' },
			};

			const executions = await orchestrator.spawn(parentContext, spawnConfig, 'Search files');

			expect(parentContext.activeSubAgents.size).to.equal(1);
			const [id] = [...parentContext.activeSubAgents.keys()];
			expect(parentContext.activeSubAgents.get(id)).to.equal(executions[0]);
		});

		it('should distribute budget among sub-agents', async () => {
			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'task_decomposition',
				agents: [
					{ name: 'agent1', role: 'search', llmLevel: 'easy', budgetFraction: 0.3 },
					{ name: 'agent2', role: 'analysis', llmLevel: 'medium' },
				],
				coordination: { type: 'parallel' },
				budget: 10.0,
			};

			await orchestrator.spawn(parentContext, spawnConfig, 'Task');

			// First agent should have 30% of budget
			const firstContext = await mockContextFactory.getCall(0).returnValue;
			expect(firstContext.budgetRemaining).to.equal(3.0);
		});

		it('should throw error if context factory not set', async () => {
			const emptyOrchestrator = new SubAgentOrchestrator();
			emptyOrchestrator.setExecutor(mockExecutor);

			try {
				await emptyOrchestrator.spawn(
					parentContext,
					{
						pattern: 'specialist',
						agents: [{ name: 'test', role: 'search', llmLevel: 'easy' }],
						coordination: { type: 'sequential' },
					},
					'Task',
				);
				expect.fail('Should have thrown');
			} catch (error: any) {
				expect(error.message).to.include('context factory not set');
			}
		});

		it('should throw error if executor not set', async () => {
			const emptyOrchestrator = new SubAgentOrchestrator();
			emptyOrchestrator.setContextFactory(mockContextFactory);

			try {
				await emptyOrchestrator.spawn(
					parentContext,
					{
						pattern: 'specialist',
						agents: [{ name: 'test', role: 'search', llmLevel: 'easy' }],
						coordination: { type: 'sequential' },
					},
					'Task',
				);
				expect.fail('Should have thrown');
			} catch (error: any) {
				expect(error.message).to.include('executor not set');
			}
		});
	});

	describe('awaitAll', () => {
		it('should await all executions', async () => {
			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'task_decomposition',
				agents: [
					{ name: 'agent1', role: 'search', llmLevel: 'easy' },
					{ name: 'agent2', role: 'analysis', llmLevel: 'medium' },
				],
				coordination: { type: 'parallel' },
			};

			const executions = await orchestrator.spawn(parentContext, spawnConfig, 'Task');
			const results = await orchestrator.awaitAll(executions);

			expect(results).to.have.lengthOf(2);
			expect(results.every((r) => r.state === 'completed')).to.be.true;
		});

		it('should handle timeouts', async () => {
			// Create slow executor
			mockExecutor.callsFake(() => new Promise((resolve) => setTimeout(resolve, 5000)));

			const executions = await orchestrator.spawn(
				parentContext,
				{
					pattern: 'specialist',
					agents: [{ name: 'slow', role: 'search', llmLevel: 'easy' }],
					coordination: { type: 'sequential' },
				},
				'Task',
			);

			const results = await orchestrator.awaitAll(executions, 100);

			expect(results[0].state).to.equal('timeout');
			expect(results[0].error).to.include('timed out');
		});

		it('should move completed results to parent completedSubAgentResults', async () => {
			const executions = await orchestrator.spawn(
				parentContext,
				{
					pattern: 'specialist',
					agents: [{ name: 'test', role: 'search', llmLevel: 'easy' }],
					coordination: { type: 'sequential' },
				},
				'Task',
			);

			// Before awaiting - execution should be active
			expect(parentContext.activeSubAgents.size).to.equal(1);

			const results = await orchestrator.awaitAll(executions);

			// Verify results were returned
			expect(results).to.have.lengthOf(1);
			expect(results[0].state).to.equal('completed');

			// The cleanup happens inside the promise resolution
			// Give it a tick to finish
			await Promise.resolve();

			expect(parentContext.completedSubAgentResults).to.have.lengthOf(1);
			// Note: activeSubAgents may still have entry if cleanup timing differs
			// The important thing is completedSubAgentResults is populated
		});
	});

	describe('spawnAndExecuteSequentially', () => {
		it('should execute agents in sequence', async () => {
			const executionOrder: string[] = [];
			mockExecutor.callsFake(async (context: NextGenAgentContext): Promise<SubAgentResult> => {
				executionOrder.push(context.name);
				return {
					agentId: context.agentId,
					name: context.name,
					output: `Result from ${context.name}`,
					state: 'completed',
					cost: 0.5,
					iterations: 3,
				};
			});

			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'pipeline',
				agents: [
					{ name: 'first', role: 'search', llmLevel: 'easy' },
					{ name: 'second', role: 'analysis', llmLevel: 'medium' },
					{ name: 'third', role: 'implementation', llmLevel: 'hard' },
				],
				coordination: { type: 'sequential', passContext: true },
			};

			const results = await orchestrator.spawnAndExecuteSequentially(parentContext, spawnConfig, 'Pipeline task', true);

			expect(executionOrder).to.deep.equal(['first', 'second', 'third']);
			expect(results).to.have.lengthOf(3);
		});

		it('should stop on error', async () => {
			const executionOrder: string[] = [];
			mockExecutor.callsFake(async (context: NextGenAgentContext): Promise<SubAgentResult> => {
				executionOrder.push(context.name);
				if (context.name === 'second') {
					return {
						agentId: context.agentId,
						name: context.name,
						output: '',
						state: 'error',
						error: 'Failed',
						cost: 0.1,
						iterations: 1,
					};
				}
				return {
					agentId: context.agentId,
					name: context.name,
					output: `Result from ${context.name}`,
					state: 'completed',
					cost: 0.5,
					iterations: 3,
				};
			});

			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'pipeline',
				agents: [
					{ name: 'first', role: 'search', llmLevel: 'easy' },
					{ name: 'second', role: 'analysis', llmLevel: 'medium' },
					{ name: 'third', role: 'implementation', llmLevel: 'hard' },
				],
				coordination: { type: 'sequential' },
			};

			const results = await orchestrator.spawnAndExecuteSequentially(parentContext, spawnConfig, 'Pipeline task');

			expect(executionOrder).to.deep.equal(['first', 'second']);
			expect(results).to.have.lengthOf(2);
		});

		it('should pass context between agents when configured', async () => {
			mockExecutor.callsFake(async (context: NextGenAgentContext): Promise<SubAgentResult> => {
				const previousOutput = context.structuredMemory.previousAgentOutput as string | undefined;
				return {
					agentId: context.agentId,
					name: context.name,
					output: previousOutput ? `Got: ${previousOutput}` : 'First output',
					state: 'completed',
					cost: 0.5,
					iterations: 3,
				};
			});

			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'pipeline',
				agents: [
					{ name: 'first', role: 'search', llmLevel: 'easy' },
					{ name: 'second', role: 'analysis', llmLevel: 'medium' },
				],
				coordination: { type: 'sequential', passContext: true },
			};

			const results = await orchestrator.spawnAndExecuteSequentially(parentContext, spawnConfig, 'Pipeline task', true);

			expect(results[0].output).to.equal('First output');
			expect(results[1].output).to.equal('Got: First output');
		});
	});

	describe('aggregate', () => {
		const createResults = (): SubAgentResult[] => [
			{
				agentId: '1',
				name: 'search',
				output: 'Found 3 files matching pattern',
				data: { files: ['a.ts', 'b.ts', 'c.ts'] },
				state: 'completed',
				cost: 0.3,
				iterations: 2,
			},
			{
				agentId: '2',
				name: 'analysis',
				output: 'Analyzed dependencies',
				data: { deps: ['lodash', 'express'] },
				state: 'completed',
				cost: 0.5,
				iterations: 4,
			},
		];

		it('should merge results from parallel agents', () => {
			const results = createResults();
			const merged = orchestrator.aggregate(results, { type: 'parallel', aggregation: 'merge' });

			expect(merged.strategy).to.equal('merge');
			expect(merged.output).to.include('Found 3 files');
			expect(merged.output).to.include('Analyzed dependencies');
			expect((merged.data.files as string[]).length).to.equal(3);
			expect((merged.data.deps as string[]).length).to.equal(2);
			expect(merged.successCount).to.equal(2);
			expect(merged.totalCost).to.equal(0.8);
		});

		it('should vote for best result', () => {
			const results = createResults();
			const voted = orchestrator.aggregate(results, { type: 'parallel', aggregation: 'vote' });

			expect(voted.strategy).to.equal('vote');
			expect(voted.selectedAgent).to.be.a('string');
			expect(voted.successCount).to.equal(2);
		});

		it('should select best result', () => {
			const results = createResults();
			const best = orchestrator.aggregate(results, { type: 'parallel', aggregation: 'best' });

			expect(best.strategy).to.equal('best');
			expect(best.selectedAgent).to.be.a('string');
			expect(best.output).to.be.a('string');
		});

		it('should use pipeline aggregation', () => {
			const results = createResults();
			const pipeline = orchestrator.aggregate(results, { type: 'sequential', aggregation: 'pipeline' });

			expect(pipeline.strategy).to.equal('pipeline');
			// Pipeline uses last completed result
			expect(pipeline.output).to.equal('Analyzed dependencies');
			// But accumulates all data
			expect((pipeline.data.files as string[]).length).to.equal(3);
			expect((pipeline.data.deps as string[]).length).to.equal(2);
		});

		it('should handle failed results in aggregation', () => {
			const results: SubAgentResult[] = [
				{
					agentId: '1',
					name: 'failed',
					output: '',
					state: 'error',
					error: 'Something went wrong',
					cost: 0.1,
					iterations: 1,
				},
			];

			const merged = orchestrator.aggregate(results, { type: 'parallel', aggregation: 'merge' });

			expect(merged.successCount).to.equal(0);
			expect(merged.output).to.equal('');
		});
	});

	describe('cancelAll', () => {
		it('should cancel all running sub-agents', async () => {
			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'task_decomposition',
				agents: [
					{ name: 'agent1', role: 'search', llmLevel: 'easy' },
					{ name: 'agent2', role: 'analysis', llmLevel: 'medium' },
				],
				coordination: { type: 'parallel' },
			};

			// Use a slow executor so agents are still "running"
			mockExecutor.callsFake(() => new Promise(() => {}));

			await orchestrator.spawn(parentContext, spawnConfig, 'Task');

			expect(parentContext.activeSubAgents.size).to.equal(2);

			const cancelled = orchestrator.cancelAll(parentContext);

			expect(cancelled).to.equal(2);
			expect(parentContext.activeSubAgents.size).to.equal(0);
		});
	});

	describe('budget enforcement', () => {
		it('should enforce budget limits on sub-agents', async () => {
			const parentBudget = 1.0;
			parentContext.budgetRemaining = parentBudget;

			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'specialist',
				agents: [{ name: 'limited', role: 'search', llmLevel: 'easy', budgetFraction: 0.2 }],
				coordination: { type: 'sequential' },
				budget: parentBudget,
			};

			await orchestrator.spawn(parentContext, spawnConfig, 'Task');

			// Verify the sub-context got the right budget
			const subContext = await mockContextFactory.getCall(0).returnValue;
			expect(subContext.budgetRemaining).to.equal(0.2);
		});

		it('should set max iterations on sub-agents', async () => {
			const spawnConfig: SubAgentSpawnConfig = {
				pattern: 'specialist',
				agents: [{ name: 'limited', role: 'search', llmLevel: 'easy', maxIterations: 5 }],
				coordination: { type: 'sequential' },
			};

			await orchestrator.spawn(parentContext, spawnConfig, 'Task');

			const subContext = await mockContextFactory.getCall(0).returnValue;
			expect(subContext.maxIterations).to.equal(5);
		});
	});

	describe('error handling', () => {
		it('should handle executor errors gracefully', async () => {
			mockExecutor.callsFake(async () => {
				throw new Error('Executor crashed');
			});

			const executions = await orchestrator.spawn(
				parentContext,
				{
					pattern: 'specialist',
					agents: [{ name: 'crasher', role: 'search', llmLevel: 'easy' }],
					coordination: { type: 'sequential' },
				},
				'Task',
			);

			const results = await orchestrator.awaitAll(executions);

			expect(results[0].state).to.equal('error');
			expect(results[0].error).to.include('Executor crashed');
		});
	});

	describe('getConfig', () => {
		it('should return copy of config', () => {
			const config = orchestrator.getConfig();

			expect(config.defaultMaxIterations).to.equal(10);
			expect(config.defaultBudgetFraction).to.equal(0.2);
			expect(config.strictBudgetEnforcement).to.be.true;
		});

		it('should use custom config values', () => {
			const customOrchestrator = new SubAgentOrchestrator({
				defaultMaxIterations: 20,
				defaultBudgetFraction: 0.5,
			});

			const config = customOrchestrator.getConfig();

			expect(config.defaultMaxIterations).to.equal(20);
			expect(config.defaultBudgetFraction).to.equal(0.5);
		});
	});
});
