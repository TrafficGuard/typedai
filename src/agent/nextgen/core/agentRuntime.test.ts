import { expect } from 'chai';
import * as sinon from 'sinon';
import type { LLM } from '#shared/llm/llm.model';
import type { LlmMessage } from '#shared/llm/llm.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { createMockAgentContext } from '../test/fixtures';
import { type AgentRunResult, AgentRuntime } from './agentRuntime';
import type { NextGenAgentConfig, NextGenAgentContext } from './types';

describe('AgentRuntime', () => {
	setupConditionalLoggerOutput();

	let runtime: AgentRuntime;
	let mockLLM: LLM;
	let mockLLMs: any;

	beforeEach(() => {
		runtime = new AgentRuntime({
			maxIterations: 10,
			maxBudget: 5.0,
			saveLearnings: false, // Disable for tests
		});

		// Create mock LLM
		mockLLM = {
			generateText: sinon.stub().resolves('Test response'),
			countTokens: sinon.stub().resolves(100),
		} as unknown as LLM;

		mockLLMs = {
			easy: mockLLM,
			medium: mockLLM,
			hard: mockLLM,
			xhard: mockLLM,
		};
	});

	afterEach(() => {
		sinon.restore();
	});

	describe('createContext', () => {
		it('should create a new agent context', async () => {
			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);

			expect(context.agentId).to.be.a('string');
			expect(context.name).to.equal('test-agent');
			expect(context.inputPrompt).to.equal('Test task');
			expect(context.iterations).to.equal(0);
			expect(context.maxIterations).to.equal(10);
		});

		it('should initialize message stack', async () => {
			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);

			expect(context.messageStack).to.exist;
			expect(context.messageStack.taskMessage.content).to.include('Test task');
		});

		it('should initialize tool loading state', async () => {
			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);

			expect(context.toolLoadingState.activeGroups).to.be.instanceOf(Set);
			expect(context.toolLoadingState.activeGroups.has('FileSystem')).to.be.true;
			expect(context.toolLoadingState.activeGroups.has('Agent')).to.be.true;
		});

		it('should respect custom compaction config', async () => {
			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
				compactionConfig: {
					iterationThreshold: 3,
					tokenThresholdPercent: 0.5,
				},
			};

			const context = await runtime.createContext(config);

			expect(context.compactionConfig.iterationThreshold).to.equal(3);
			expect(context.compactionConfig.tokenThresholdPercent).to.equal(0.5);
		});

		it('should set initial memory', async () => {
			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
				initialMemory: { key: 'value' },
			};

			const context = await runtime.createContext(config);

			expect(context.memory.key).to.equal('value');
		});
	});

	describe('run', () => {
		it('should complete on completion marker', async () => {
			(mockLLM.generateText as sinon.SinonStub).resolves('Task done <completed>');

			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);
			const result = await runtime.run(context, mockLLM);

			expect(result.state).to.equal('completed');
			expect(result.output).to.include('Task done');
			expect(result.iterations).to.equal(1);
		});

		it('should track iterations', async () => {
			let callCount = 0;
			(mockLLM.generateText as sinon.SinonStub).callsFake(async () => {
				callCount++;
				if (callCount >= 3) {
					return 'Done <completed>';
				}
				return `Response ${callCount}`;
			});

			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);
			const result = await runtime.run(context, mockLLM);

			expect(result.iterations).to.equal(3);
		});

		it('should stop at max iterations', async () => {
			const limitedRuntime = new AgentRuntime({
				maxIterations: 3,
				saveLearnings: false,
			});

			(mockLLM.generateText as sinon.SinonStub).resolves('Still working...');

			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await limitedRuntime.createContext(config);
			const result = await limitedRuntime.run(context, mockLLM);

			expect(result.state).to.equal('max_iterations');
			expect(result.iterations).to.equal(3);
		});

		it('should stop when budget exceeded', async () => {
			// Note: Cost tracking via generateText is not currently supported
			// This test verifies budget check works when cost is pre-set
			const limitedRuntime = new AgentRuntime({
				maxBudget: 0.02,
				saveLearnings: false,
			});

			(mockLLM.generateText as sinon.SinonStub).resolves('Still working...');

			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await limitedRuntime.createContext(config);
			// Pre-set cost to exceed budget
			context.cost = 0.03;
			context.budgetRemaining = -0.01;
			const result = await limitedRuntime.run(context, mockLLM);

			expect(result.state).to.equal('budget_exceeded');
		});

		it('should complete with multiple iterations', async () => {
			let callCount = 0;
			(mockLLM.generateText as sinon.SinonStub).callsFake(async () => {
				callCount++;
				if (callCount >= 2) {
					return 'Done <completed>';
				}
				return 'Working...';
			});

			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);
			const result = await runtime.run(context, mockLLM);

			expect(result.iterations).to.equal(2);
		});

		it('should call iteration callback', async () => {
			const iterations: number[] = [];
			const callback = sinon.stub().callsFake((iter: number) => {
				iterations.push(iter);
			});

			let callCount = 0;
			(mockLLM.generateText as sinon.SinonStub).callsFake(async () => {
				callCount++;
				if (callCount >= 2) {
					return 'Done <completed>';
				}
				return 'Working...';
			});

			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);
			await runtime.run(context, mockLLM, callback);

			expect(iterations).to.deep.equal([1, 2]);
		});

		it('should handle errors gracefully', async () => {
			(mockLLM.generateText as sinon.SinonStub).rejects(new Error('LLM error'));

			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);
			const result = await runtime.run(context, mockLLM);

			expect(result.state).to.equal('error');
			expect(result.error).to.include('LLM error');
		});
	});

	describe('cancel', () => {
		it('should cancel running agent', async () => {
			(mockLLM.generateText as sinon.SinonStub).callsFake(async () => {
				// Simulate some work
				await new Promise((resolve) => setTimeout(resolve, 50));
				return 'Response';
			});

			const config: NextGenAgentConfig = {
				name: 'test-agent',
				prompt: 'Test task',
				llms: mockLLMs,
				functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
			};

			const context = await runtime.createContext(config);
			const runPromise = runtime.run(context, mockLLM);

			// Cancel after first iteration
			setTimeout(() => runtime.cancel(), 100);

			const result = await runPromise;

			expect(result.state).to.equal('cancelled');
		});
	});

	describe('getters', () => {
		it('should return context manager', () => {
			const contextManager = runtime.getContextManager();
			expect(contextManager).to.exist;
		});

		it('should return tool loader', () => {
			const toolLoader = runtime.getToolLoader();
			expect(toolLoader).to.exist;
		});

		it('should return compaction service', () => {
			const compactionService = runtime.getCompactionService();
			expect(compactionService).to.exist;
		});

		it('should return knowledge base', () => {
			const knowledgeBase = runtime.getKnowledgeBase();
			expect(knowledgeBase).to.exist;
		});

		it('should return orchestrator', () => {
			const orchestrator = runtime.getOrchestrator();
			expect(orchestrator).to.exist;
		});

		it('should return config copy', () => {
			const config = runtime.getConfig();
			expect(config.maxIterations).to.equal(10);
			expect(config.maxBudget).to.equal(5.0);
		});
	});
});

describe('AgentRuntime Integration', () => {
	setupConditionalLoggerOutput();

	let runtime: AgentRuntime;
	let mockLLM: LLM;
	let mockLLMs: any;
	let responses: string[];
	let responseIndex: number;

	beforeEach(() => {
		runtime = new AgentRuntime({
			maxIterations: 20,
			saveLearnings: false,
		});

		responses = [];
		responseIndex = 0;

		mockLLM = {
			generateText: sinon.stub().callsFake(async () => {
				const response = responses[responseIndex] ?? 'Default response <completed>';
				responseIndex++;
				return response;
			}),
			countTokens: sinon.stub().resolves(100),
		} as unknown as LLM;

		mockLLMs = {
			easy: mockLLM,
			medium: mockLLM,
			hard: mockLLM,
			xhard: mockLLM,
		};
	});

	afterEach(() => {
		sinon.restore();
	});

	it('should complete multi-step task', async () => {
		responses = ['First, let me search for files', 'Found the files, now editing', 'Changes complete <completed>'];

		const config: NextGenAgentConfig = {
			name: 'test-agent',
			prompt: 'Find and edit files',
			llms: mockLLMs,
			functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
		};

		const context = await runtime.createContext(config);
		const result = await runtime.run(context, mockLLM);

		expect(result.state).to.equal('completed');
		expect(result.iterations).to.equal(3);
	});

	it('should handle function call responses', async () => {
		responses = ['<function_call>Agent_loadToolGroup("Git")</function_call>', 'Now using Git tools <completed>'];

		const config: NextGenAgentConfig = {
			name: 'test-agent',
			prompt: 'Load Git tools',
			llms: mockLLMs,
			functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
		};

		const context = await runtime.createContext(config);
		const result = await runtime.run(context, mockLLM);

		expect(result.state).to.equal('completed');
		// Tool group should be loaded
		expect(context.toolLoadingState.activeGroups.has('Git')).to.be.true;
	});

	it('should maintain context across iterations', async () => {
		const iterationContexts: number[] = [];

		responses = ['Iteration 1', 'Iteration 2', 'Iteration 3 <completed>'];

		const config: NextGenAgentConfig = {
			name: 'test-agent',
			prompt: 'Multi-iteration task',
			llms: mockLLMs,
			functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
		};

		const context = await runtime.createContext(config);
		await runtime.run(context, mockLLM, (iter, ctx) => {
			iterationContexts.push(iter);
			// Context should maintain state across iterations
			expect(ctx.agentId).to.equal(context.agentId);
		});

		expect(iterationContexts).to.deep.equal([1, 2, 3]);
	});

	it('should handle completed() function call', async () => {
		responses = ['<function_call>completed()</function_call>'];

		const config: NextGenAgentConfig = {
			name: 'test-agent',
			prompt: 'Complete immediately',
			llms: mockLLMs,
			functions: { getFunctions: () => [], getFunctionSchemas: () => [] } as any,
		};

		const context = await runtime.createContext(config);
		const result = await runtime.run(context, mockLLM);

		// completed() triggers completion
		expect(result.iterations).to.equal(1);
	});
});
