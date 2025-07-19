import { agentExecutions } from '#agent/autonomous/autonomousAgentRunner';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { initInMemoryApplicationContext } from '#memory/inMemoryApplicationContext';
import { AGENT_API } from '#shared/agent/agent.api';
import type { AgentContext, AgentContextPreview } from '#shared/agent/agent.model';
import { toAgentContextPreview } from '#shared/agent/agent.utils';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { expect } from 'chai';
import type { FastifyInstance } from 'fastify';
import { listRunningAgentsRoute } from './listRunningAgentsRoute';

describe.skip('GET /api/agents/running', () => {
	setupConditionalLoggerOutput();
	let fastify: FastifyInstance;

	before(async () => {
		const applicationContext = await initInMemoryApplicationContext();
		fastify = (applicationContext as any).fastify;
		await listRunningAgentsRoute(fastify as AppFastifyInstance);
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
			url: AGENT_API.listRunning.path,
		});

		expect(response.statusCode).to.equal(200);
		expect(JSON.parse(response.payload)).to.deep.equal([]);
	});

	it('should return only running agents and filter out terminal ones', async () => {
		const runningAgent: AgentContext = {
			agentId: 'running-1',
			state: 'running',
			userPrompt: 'running agent',
			messages: [],
			functions: [],
			toolState: {},
		};
		const pendingAgent: AgentContext = {
			agentId: 'pending-1',
			state: 'pending',
			userPrompt: 'pending agent',
			messages: [],
			functions: [],
			toolState: {},
		};
		const completedAgent: AgentContext = {
			agentId: 'completed-1',
			state: 'completed',
			userPrompt: 'completed agent',
			messages: [],
			functions: [],
			toolState: {},
		};

		await (fastify as AppFastifyInstance).agentStateService.save(runningAgent);
		await (fastify as AppFastifyInstance).agentStateService.save(pendingAgent);
		await (fastify as AppFastifyInstance).agentStateService.save(completedAgent);

		agentExecutions[runningAgent.agentId] = {} as any;
		agentExecutions[pendingAgent.agentId] = {} as any;
		agentExecutions[completedAgent.agentId] = {} as any;

		const response = await fastify.inject({
			method: 'GET',
			url: AGENT_API.listRunning.path,
		});

		expect(response.statusCode).to.equal(200);
		const body = JSON.parse(response.payload) as AgentContextPreview[];
		expect(body).to.have.lengthOf(2);

		const expectedPreviews = [toAgentContextPreview(runningAgent), toAgentContextPreview(pendingAgent)];
		expect(body).to.have.deep.members(expectedPreviews);
	});
});
