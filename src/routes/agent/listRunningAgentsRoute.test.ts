import { agentExecutions } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { inMemoryApplicationContext } from '#modules/memory/inMemoryApplicationContext';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AgentContext, AgentContextPreview, FunctionCall, LlmFunctions, ToolType } from '#shared/agent/agent.model';
import { toAgentContextPreview } from '#shared/agent/agent.utils';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { expect } from 'chai';
import Fastify, { type FastifyInstance } from 'fastify';
import { listRunningAgentsRoute } from './listRunningAgentsRoute';

describe.skip('GET /api/agents/running', () => {
	setupConditionalLoggerOutput();
	let fastify: AppFastifyInstance;

	before(async () => {
		const applicationContext = inMemoryApplicationContext();
		fastify = Fastify() as AppFastifyInstance;
		Object.assign(fastify, applicationContext);
		await listRunningAgentsRoute(fastify);
	});

	after(() => {
		fastify.close();
	});

	beforeEach(() => {
		// Clear the executions before each test
		for (const key in agentExecutions) {
			delete agentExecutions[key];
		}
	});

	it('should return an empty array when no agents are executing', async () => {
		const response = await fastify.inject({
			method: 'GET',
			url: AGENT_API.listRunning.pathTemplate,
		});

		expect(response.statusCode).to.equal(200);
		expect(JSON.parse(response.payload)).to.deep.equal([]);
	});

	it('should return only running agents and filter out terminal ones', async () => {
		const mockLlmFunctions: LlmFunctions = {
			toJSON: () => ({ functionClasses: [] }),
			fromJSON: function (obj: any) {
				return this;
			},
			removeFunctionClass: (functionClassName: string) => {},
			getFunctionInstances: () => [],
			getFunctionInstanceMap: () => ({}),
			getFunctionClassNames: () => [],
			getFunctionType: (type: ToolType) => null,
			addFunctionInstance: (functionClassInstance: object, name: string) => {},
			addFunctionClass: (...functionClasses: Array<new () => any>) => {},
			callFunction: (functionCall: FunctionCall) => Promise.resolve(null),
		};

		const baseAgentContext = {
			name: 'Test Agent',
			cost: 0,
			lastUpdate: Date.now(),
			type: 'autonomous',
			subtype: 'test',
			createdAt: Date.now(),
			user: { id: 'test-user', name: 'Test User', email: 'test@test.com' },
			metadata: {},
			messages: [],
			functions: mockLlmFunctions,
			toolState: {},
			executionId: 'exec-1',
			typedAiRepoDir: '',
			traceId: 'trace-1',
			callStack: [],
			hilBudget: 0,
			budgetRemaining: 0,
			llms: {} as any,
			fileSystem: null,
			useSharedRepos: true,
			memory: {},
			pendingMessages: [],
			iterations: 0,
			invoking: [],
			notes: [],
			inputPrompt: '',
			functionCallHistory: [],
			hilCount: 0,
		};

		const runningAgent = {
			...baseAgentContext,
			agentId: 'running-1',
			state: 'agent',
			userPrompt: 'running agent',
		} as AgentContext;
		const pendingAgent = {
			...baseAgentContext,
			agentId: 'pending-1',
			state: 'workflow',
			userPrompt: 'pending agent',
		} as AgentContext;
		const completedAgent = {
			...baseAgentContext,
			agentId: 'completed-1',
			state: 'completed',
			userPrompt: 'completed agent',
		} as AgentContext;

		await (fastify as AppFastifyInstance).agentStateService.save(runningAgent);
		await (fastify as AppFastifyInstance).agentStateService.save(pendingAgent);
		await (fastify as AppFastifyInstance).agentStateService.save(completedAgent);

		agentExecutions[runningAgent.agentId] = {} as any;
		agentExecutions[pendingAgent.agentId] = {} as any;
		agentExecutions[completedAgent.agentId] = {} as any;

		const response = await fastify.inject({
			method: 'GET',
			url: AGENT_API.listRunning.pathTemplate,
		});

		expect(response.statusCode).to.equal(200);
		const body = JSON.parse(response.payload) as AgentContextPreview[];
		expect(body).to.have.lengthOf(2);

		const expectedPreviews = [toAgentContextPreview(runningAgent), toAgentContextPreview(pendingAgent)];
		expect(body).to.have.deep.members(expectedPreviews);
	});
});
