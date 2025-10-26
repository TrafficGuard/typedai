import { expect } from 'chai';
import sinon from 'sinon';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { SUPERVISOR_CANCELLED_FUNCTION_NAME, cancelAgent, provideFeedback, runAgentAndWait, startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { AGENT_REQUEST_FEEDBACK, AgentFeedback, REQUEST_FEEDBACK_PARAM_NAME } from '#agent/autonomous/functions/agentFeedback';
import { AGENT_COMPLETED_NAME } from '#agent/autonomous/functions/agentFunctions';
import { XML_AGENT_SPAN } from '#agent/autonomous/xml/xmlAutonomousAgent';
import { appContext, initInMemoryApplicationContext } from '#app/applicationContext';
import { TEST_FUNC_NOOP, TEST_FUNC_SKY_COLOUR, TEST_FUNC_SUM, THROW_ERROR_TEXT, TestFunctions } from '#functions/testFunctions';
import { MockLLM } from '#llm/services/mock-llm';
import { setTracer } from '#o11y/trace';
import type { AgentContext, AgentLLMs } from '#shared/agent/agent.model';
import { lastText } from '#shared/llm/llm.model';
import type { User } from '#shared/user/user.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { sleep } from '#utils/async-utils';
import { agentContextStorage } from '../../agentContextLocalStorage';
import { type RunAgentConfig } from '../runAgentTypes';

const REQUEST_FEEDBACK_VALUE = 'question is...';
const REQUEST_FEEDBACK_FUNCTION_CALL = `<plan>Requesting feedback</plan>\n<function_calls><function_call><function_name>${AGENT_REQUEST_FEEDBACK}</function_name><parameters><${REQUEST_FEEDBACK_PARAM_NAME}>${REQUEST_FEEDBACK_VALUE}</${REQUEST_FEEDBACK_PARAM_NAME}></parameters></function_call></function_calls>`;
const COMPLETE_FUNCTION_CALL = `<plan>Ready to complete</plan>\n<function_calls><function_call><function_name>${AGENT_COMPLETED_NAME}</function_name><parameters></parameters></function_call></function_calls>`;
const NOOP_FUNCTION_CALL = `<plan>I'm going to call the noop function</plan>\n<function_calls><function_call><function_name>${TEST_FUNC_NOOP}</function_name><parameters></parameters></function_call></function_calls>`;
const SKY_COLOUR_FUNCTION_CALL = `<plan>Get the sky colour</plan>\n<function_calls><function_call><function_name>${TEST_FUNC_SKY_COLOUR}</function_name><parameters></parameters></function_call></function_calls>`;

describe('xmlAgentRunner', () => {
	setupConditionalLoggerOutput();

	const app = appContext();
	let mockLLM = new MockLLM();
	let llms: AgentLLMs = {
		easy: mockLLM,
		medium: mockLLM,
		hard: mockLLM,
		xhard: mockLLM,
	};
	let functions = new LlmFunctionsImpl();
	const AGENT_NAME = 'test';

	function runConfig(runConfig?: Partial<RunAgentConfig>): RunAgentConfig {
		const defaults: RunAgentConfig = {
			agentName: AGENT_NAME,
			initialPrompt: 'test prompt',
			systemPrompt: '<functions></functions>',
			type: 'autonomous',
			subtype: 'xml',
			llms,
			functions,
			user: app.userService.getSingleUser(),
		};
		return runConfig ? { ...defaults, ...runConfig } : defaults;
	}
	function createUser(user?: Partial<User>): User {
		const defaults: User = {
			email: '',
			name: 'John Doe',
			enabled: true,
			hilBudget: 0,
			hilCount: 0,
			id: '',
			chat: {
				enabledLLMs: {},
				defaultLLM: '',
				temperature: 1,
			},
			llmConfig: {},
			functionConfig: {},
			createdAt: new Date(),
		};
		return user ? { ...defaults, ...user } : defaults;
	}

	async function waitForAgent(): Promise<AgentContext | null> {
		let previewList = await appContext().agentStateService.list();
		while (previewList.filter((agent) => agent.state === 'agent' || agent.state === 'functions').length > 0) {
			await sleep(1000);
			previewList = await appContext().agentStateService.list();
		}
		const agents = previewList; // previews
		if (agents.length !== 1) {
			throw new Error('Expecting only one agent to exist');
		}
		// Load the full agent context as the tests expect it
		return appContext().agentStateService.load(agents[0].agentId);
	}

	beforeEach(() => {
		initInMemoryApplicationContext();
		// This is needed for the tests on the LlmCall.callStack property
		setTracer(null, agentContextStorage);
		mockLLM = new MockLLM();
		llms = {
			easy: mockLLM,
			medium: mockLLM,
			hard: mockLLM,
			xhard: mockLLM,
		};
		functions = new LlmFunctionsImpl();
	});

	describe('test function calling', () => {
		it('should be able to call a function with multiple parameters', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(
				`<plan>call sum</plan><function_calls><function_call><function_name>${TEST_FUNC_SUM}</function_name><parameters><num1>3</num1><num2>6</num2></parameters></function_call></function_calls>`,
			);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL);
			await startAgent(runConfig({ initialPrompt: 'Add 3 and 6', functions: functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			// spy on sum
			expect(agent!.state).to.equal('completed');
		});
	});

	describe('Agent.complete usage', () => {
		it('should be able to complete on the initial function call', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL);
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.error).to.be.undefined;
			expect(agent!.state).to.equal('completed');
		});

		it('should be able to complete on the second function call', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(NOOP_FUNCTION_CALL);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL);
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(!agent!.error).to.be.true;
			expect(agent!.state).to.equal('completed');
		});
	});

	describe('Agent.requestFeedback usage', () => {
		it('should be able to request feedback', async () => {
			mockLLM.addResponse(REQUEST_FEEDBACK_FUNCTION_CALL);
			functions.addFunctionClass(AgentFeedback);
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.functionCallHistory.length).to.equal(1);
			expect(agent!.state).to.equal('hitl_feedback');

			// mockLLM.addResponse(COMPLETE_FUNCTION_CALL);
			// await provideFeedback(agent!.agentId, agent!.executionId, 'the feedback');
			// agent = await waitForAgent();
			// // Re-fetch or wait for agent to update state
			// agent = await appContext().agentStateService.load(agent!.agentId);
			// expect(agent).to.exist;
			// expect(agent!.state).to.equal('completed');
			// expect(agent!.functionCallHistory[0].stdout).to.equal('the feedback');
		});
	});

	describe('user/initial prompt handling', () => {
		it('the initial prompt should set on the agent after multiple function calls', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(NOOP_FUNCTION_CALL);
			mockLLM.addResponse(NOOP_FUNCTION_CALL);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL);
			const initialPrompt = 'Initial prompt test';
			await startAgent(runConfig({ initialPrompt, functions: functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.userPrompt).to.equal(initialPrompt);
		});

		it('should extract the user request when <user_request></user_request> exists in the prompt', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(NOOP_FUNCTION_CALL);
			mockLLM.addResponse(NOOP_FUNCTION_CALL);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL);
			const initialPrompt = 'Initial request test';
			await startAgent(runConfig({ initialPrompt: `<user_request>${initialPrompt}</user_request>`, functions: functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.userPrompt).to.equal(initialPrompt);
		});
	});

	describe('Function call throws an error', () => {
		it('should end the agent in the error state with the exception message in the error field', async () => {
			functions.addFunctionInstance(new TestFunctions(), 'TestFunctions');

			const functionName = 'TestFunctions_throwError';
			const response = `<function_calls><function_call><function_name>${functionName}</function_name><parameters></parameters></function_call></function_calls>`;
			mockLLM.addResponse(response);

			const id = await runAgentAndWait(runConfig({ functions }));
			const ctx = await appContext().agentStateService.load(id);
			expect(ctx).to.exist;
			expect(ctx!.state).to.equal('error');
			expect(ctx!.error).to.include(THROW_ERROR_TEXT);
		});
	});

	describe('Resuming agent', () => {
		describe('Feedback provided', () => {
			it.skip('should resume the agent with the feedback', async () => {
				mockLLM.addResponse(REQUEST_FEEDBACK_FUNCTION_CALL);
				functions.addFunctionClass(AgentFeedback);
				await startAgent(runConfig({ functions }));
				let agent = await waitForAgent();
				expect(agent).to.exist;
				mockLLM.assertNoPendingResponses();

				mockLLM.addResponse(COMPLETE_FUNCTION_CALL);
				await provideFeedback(agent!.agentId, agent!.executionId, 'the feedback');
				agent = await waitForAgent(); // Re-wait or load after feedback
				expect(agent).to.exist;

				expect(agent!.state).to.equal('completed');
				const functionCallResult = agent!.functionCallHistory.find((call) => call.function_name === AGENT_REQUEST_FEEDBACK);
				expect(functionCallResult!.stdout).to.equal('the feedback');
			});
		});
	});

	describe('Cancel errored agent', () => {
		it('should cancel the agent with note as output of the Supervisor.cancelled function call', async () => {
			functions.addFunctionClass(TestFunctions);
			const functionName = 'TestFunctions.throwError';
			const response = `<function_calls><function_call><function_name>${functionName}</function_name><parameters></parameters></function_call></function_calls>`;
			mockLLM.addResponse(response);
			await startAgent(runConfig({ functions }));
			let agent = await waitForAgent();
			expect(agent).to.exist;

			await cancelAgent(agent!.agentId, agent!.executionId, 'cancelled');
			agent = await waitForAgent(); // Re-wait or load
			expect(agent).to.exist;

			expect(agent!.state).to.equal('completed');
			const functionCallResult = agent!.functionCallHistory.find((call) => call.function_name === SUPERVISOR_CANCELLED_FUNCTION_NAME);
			expect(functionCallResult!.stdout).to.equal('cancelled');
		});
	});

	describe('LLM calls', () => {
		it.skip('should have the call stack', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(SKY_COLOUR_FUNCTION_CALL);
			mockLLM.addResponse('blue');
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL);
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.state).to.equal('completed');

			const calls = await appContext().llmCallService.getLlmCallsForAgent(agent!.agentId);
			expect(calls.length).to.equal(3);
			const skyCall = calls[1];
			expect(skyCall.callStack).to.equal(`${AGENT_NAME} > ${XML_AGENT_SPAN} > skyColour > generateText`);
			expect(lastText(skyCall.messages)).to.equal('blue');
		});
	});
});
