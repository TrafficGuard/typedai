import { expect } from 'chai';
import sinon from 'sinon';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { SUPERVISOR_CANCELLED_FUNCTION_NAME, cancelAgent, provideFeedback, runAgentAndWait, startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { convertTypeScriptToPython } from '#agent/autonomous/codegen/pythonCodeGenUtils';
import { AGENT_REQUEST_FEEDBACK, AgentFeedback } from '#agent/autonomous/functions/agentFeedback';
import { AGENT_COMPLETED_NAME, AGENT_MEMORY } from '#agent/autonomous/functions/agentFunctions';
import { appContext, initInMemoryApplicationContext } from '#app/applicationContext';
import { TEST_FUNC_NOOP, TEST_FUNC_SKY_COLOUR, TEST_FUNC_SUM, TEST_FUNC_THROW_ERROR, TestFunctions } from '#functions/testFunctions';
import { MockLLM, mockLLM, mockLLMs } from '#llm/services/mock-llm';
import { logger } from '#o11y/logger';
import { setTracer } from '#o11y/trace';
import type { AgentContext } from '#shared/agent/agent.model';
import { lastText } from '#shared/llm/llm.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { sleep } from '#utils/async-utils';
import { agentContextStorage } from '../../agentContextLocalStorage';
import { type RunAgentConfig } from '../runAgentTypes';

const PY_AGENT_COMPLETED = (note: string) => `await ${AGENT_COMPLETED_NAME}("${note}")`;
const PY_AGENT_REQUEST_FEEDBACK = (feedback: string) => `await ${AGENT_REQUEST_FEEDBACK}("${feedback}")`;

const PY_TEST_FUNC_NOOP = `await ${TEST_FUNC_NOOP}()`;
const PY_TEST_FUNC_SKY_COLOUR = `await ${TEST_FUNC_SKY_COLOUR}()`;
const PY_TEST_FUNC_SUM = (num1, num2) => `await ${TEST_FUNC_SUM}(${num1}, ${num2})`;
const PY_TEST_FUNC_THROW_ERROR = `await ${TEST_FUNC_THROW_ERROR}()`;
const PY_SET_MEMORY = (key, content) => `await ${AGENT_MEMORY}("SAVE", "${key}", "${content}")`;

const PYTHON_CODE_PLAN = (pythonCode: string) => `<response>\n<plan>Run some code</plan>\n<agent:python_code>${pythonCode}</agent:python_code>\n</response>`;
const REQUEST_FEEDBACK_FUNCTION_CALL_PLAN = (feedback) =>
	`<response>\n<plan>Requesting feedback</plan>\n<agent:python_code>${PY_AGENT_REQUEST_FEEDBACK(feedback)}</agent:python_code>\n</response>`;

const COMPLETE_FUNCTION_CALL_PLAN = `<response>\n<plan>Ready to complete</plan>\n<agent:python_code>${PY_AGENT_COMPLETED('done')}</agent:python_code>\n</response>`;

const ITERATION_SUMMARY_RESPONSE = '';

const NOOP_FUNCTION_CALL_PLAN = `<response>\n<plan>I'm going to call the noop function</plan>\n<agent:python_code>${PY_TEST_FUNC_NOOP}</agent:python_code>\n</response>`;

const SKY_COLOUR_FUNCTION_CALL_PLAN = `<response>\n<plan>Get the sky colour</plan>\n<agent:python_code>${PY_TEST_FUNC_SKY_COLOUR}</agent:python_code>\n</response>`;

function result(contents: string): string {
	return `<result>${contents}</result>`;
}

describe('codegenAgentRunner', () => {
	setupConditionalLoggerOutput();
	const ctx = initInMemoryApplicationContext();

	let functions: LlmFunctionsImpl;
	let mockLLM: MockLLM;
	const AGENT_NAME = 'test';

	function runConfig(runConfig?: Partial<RunAgentConfig>): RunAgentConfig {
		const defaults: RunAgentConfig = {
			agentName: AGENT_NAME,
			initialPrompt: 'test prompt',
			systemPrompt: '<functions></functions>',
			type: 'autonomous',
			subtype: 'codegen',
			llms: { easy: mockLLM, medium: mockLLM, hard: mockLLM, xhard: mockLLM },
			functions,
			user: ctx.userService.getSingleUser(),
		};
		return runConfig ? { ...defaults, ...runConfig } : defaults;
	}
	// function createUser(user?: Partial<User>): User {
	// 	const defaults: User = {
	// 		email: '',
	// 		enabled: true,
	// 		hilBudget: 0,
	// 		hilCount: 0,
	// 		id: '',
	// 		llmConfig: {},
	// 		functionConfig: {},
	// 	};
	// 	return user ? { ...defaults, ...user } : defaults;
	// }

	async function waitForAgent(): Promise<AgentContext | null> {
		let previewList = await appContext().agentStateService.list();
		while (previewList.filter((agent) => agent.state === 'agent' || agent.state === 'functions').length > 0) {
			await sleep(10);
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
		setTracer(null);
		mockLLM = mockLLMs().easy as MockLLM;
		mockLLM.reset();
		functions = new LlmFunctionsImpl(AgentFeedback);
	});

	afterEach(() => {
		// mockLLM.assertNoPendingResponses(); individual tests shuld assert this if required
		logger.flush();
	});

	describe('test function calling', () => {
		it('should be able to call a function with multiple parameters and evolve the prompt', async () => {
			functions.addFunctionClass(TestFunctions);
			const initialCode = `${PY_SET_MEMORY('memKey', 'contents')}\n${PY_TEST_FUNC_SUM(3, 6)}`;
			const secondCode = `${PY_TEST_FUNC_SUM(42, 42)}`;

			// Arrange: Queue all necessary LLM responses for the entire agent run
			mockLLM
				.addResponse(PYTHON_CODE_PLAN(initialCode)) // 1. Initial plan to sum 3 and 6
				.addResponse(ITERATION_SUMMARY_RESPONSE) // 2. Summary of first iteration
				.addResponse(PYTHON_CODE_PLAN(secondCode)) // 3. Second plan to sum 42 and 42
				.addResponse(ITERATION_SUMMARY_RESPONSE) // 4. Summary of second iteration
				.addResponse(COMPLETE_FUNCTION_CALL_PLAN) // 5. Final plan to complete
				.addResponse(ITERATION_SUMMARY_RESPONSE); // 6. Summary of completion
			// No summary needed for completion, as it halts execution.

			// Act: Run the agent and wait for it to finish
			await startAgent(runConfig({ initialPrompt: 'Task is to sum 3 and 6, then 42 and 42.', functions }));
			const agent = await waitForAgent();

			// Assert
			expect(agent).to.exist;
			expect(agent!.state).to.equal('completed');

			const textCalls = mockLLM.getTextCalls();
			expect(textCalls).to.have.lengthOf(6);

			// Assert on the first prompt
			const initialPrompt = textCalls[0].userPrompt;
			expect(initialPrompt).to.contain('Task is to sum 3 and 6, then 42 and 42.');
			// expect(initialPrompt).to.not.contain('<function_call_history>');
			// expect(initialPrompt).to.not.contain('<memory>');

			// Assert on the second prompt
			const secondPrompt = textCalls[2].userPrompt;
			// expect(secondPrompt).to.contain('<function_call_history>');
			// expect(secondPrompt).to.contain(`<function_name>${TEST_FUNC_SUM}</function_name>`);
			// expect(secondPrompt).to.contain('<stdout>9</stdout>'); // Result of 3 + 6
			// expect(secondPrompt).to.contain('<memory>');
			// expect(secondPrompt).to.contain('<key>memKey</key>');
			// expect(secondPrompt).to.contain('<content>contents</content>');
		});
	});

	describe('Agent.complete usage', () => {
		it('should be able to complete on the initial function call', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN).addResponse(ITERATION_SUMMARY_RESPONSE);
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.error).to.be.undefined;
			expect(agent!.state).to.equal('completed');
		});

		it('should be able to complete on the second function call', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM
				.addResponse(NOOP_FUNCTION_CALL_PLAN)
				.addResponse(ITERATION_SUMMARY_RESPONSE)
				.addResponse(COMPLETE_FUNCTION_CALL_PLAN)
				.addResponse(ITERATION_SUMMARY_RESPONSE);
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.error).to.be.undefined;
			expect(agent!.state).to.equal('completed');
		});
	});

	describe('Agent.requestFeedback usage', () => {
		it('should be able to request feedback', async () => {
			const feedbackNote = 'the feedback XYZ';
			mockLLM.addResponse(REQUEST_FEEDBACK_FUNCTION_CALL_PLAN(feedbackNote)).addResponse(ITERATION_SUMMARY_RESPONSE);

			await startAgent(runConfig({ functions }));
			let agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.functionCallHistory.length).to.equal(1);
			expect(agent!.state).to.equal('hitl_feedback');

			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN).addResponse(ITERATION_SUMMARY_RESPONSE);

			logger.info('Providing feedback...');
			await provideFeedback(agent!.agentId, agent!.executionId, feedbackNote);
			agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.state).to.equal('completed');

			const postFeedbackPrompt = mockLLM.getTextCalls()[1].userPrompt;
			expect(postFeedbackPrompt).to.include(feedbackNote);
			expect(agent!.functionCallHistory[0].stdout).to.equal(feedbackNote);
		});
	});

	describe('user/initial prompt handling', () => {
		it('the initial prompt should set on the agent after multiple function calls', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(NOOP_FUNCTION_CALL_PLAN);
			mockLLM.addResponse(NOOP_FUNCTION_CALL_PLAN);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN);
			const initialPrompt = 'Initial prompt test';
			await startAgent(runConfig({ initialPrompt, functions: functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.userPrompt).to.equal(initialPrompt);
		});

		it('should extract the user request when <user_request></user_request> exists in the prompt', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(NOOP_FUNCTION_CALL_PLAN);
			mockLLM.addResponse(NOOP_FUNCTION_CALL_PLAN);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN);
			const initialPrompt = 'Initial request test';
			await startAgent(runConfig({ initialPrompt: `<user_request>${initialPrompt}</user_request>`, functions: functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.userPrompt).to.equal(initialPrompt);
		});
	});

	describe('If theres an indentation error then it should retry', () => {
		it('If theres an indentation error then it should retry', async () => {
			functions.addFunctionClass(TestFunctions);
			// Add extra indentation
			mockLLM.addResponse(PYTHON_CODE_PLAN(`  ${PY_AGENT_COMPLETED('done')}`)); // 1. LLM generates code with indentation error
			// No summary here as the agent's python script fails before summary generation.
			// The next LLM call is to fix the syntax.
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN); // 2. LLM provides fixed code
			mockLLM.addResponse('<summary>Test summary after syntax fix and completion.</summary>'); // 3. Summary for the successful completion
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.error).to.be.undefined;
			expect(agent!.state).to.equal('completed');
		});
	});

	describe('Function call throws an error', () => {
		it.skip('should continue on if a function throws an error', async () => {
			functions.addFunctionClass(TestFunctions);
			const planWithErroredCode = PYTHON_CODE_PLAN(PY_TEST_FUNC_THROW_ERROR);

			// Arrange: Queue up responses for an error and subsequent completion
			mockLLM
				.addResponse(planWithErroredCode) // 1. Agent plans to call the function that throws
				.addResponse(ITERATION_SUMMARY_RESPONSE) // 2. Summary of the failed iteration
				.addResponse(COMPLETE_FUNCTION_CALL_PLAN); // 3. Agent plans to complete after handling the error

			// Act
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();

			// Assert
			expect(agent).to.exist;
			expect(agent!.state).to.equal('completed');

			const textCalls = mockLLM.getTextCalls();
			expect(textCalls).to.have.lengthOf(3);

			// The prompt for the second planning phase should contain the error from the first
			const retryPrompt = textCalls[2].userPrompt;
			expect(retryPrompt).to.contain('<stderr>');
			expect(retryPrompt).to.contain('This is a test error');
			expect(retryPrompt).to.contain('</stderr>');
		});
	});

	describe('Resuming agent', () => {
		describe('Feedback provided', () => {
			it('should resume the agent with the feedback', async () => {
				const feedbackNote = 'the feedback';
				// Arrange: First run until feedback is requested
				mockLLM.addResponse(REQUEST_FEEDBACK_FUNCTION_CALL_PLAN(feedbackNote)).addResponse(ITERATION_SUMMARY_RESPONSE);

				// Act: Start agent and wait for it to pause for feedback
				await startAgent(runConfig({ functions }));
				let agent = await waitForAgent();
				expect(agent).to.exist;
				expect(agent!.state).to.equal('hitl_feedback');

				// Arrange: Queue responses for the run after feedback is provided
				mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN).addResponse(ITERATION_SUMMARY_RESPONSE);

				// Act: Provide feedback and wait for completion
				await provideFeedback(agent!.agentId, agent!.executionId, feedbackNote);
				agent = await waitForAgent();

				// Assert
				expect(agent).to.exist;
				expect(agent!.state).to.equal('completed');
				const functionCallResult = agent!.functionCallHistory.find((call) => call.function_name === AGENT_REQUEST_FEEDBACK);
				expect(functionCallResult).to.exist;
				expect(functionCallResult!.stdout).to.equal(feedbackNote);
			});
		});
	});

	describe('Cancel errored agent', () => {
		it.skip('should cancel the agent with note as output of the Supervisor.cancelled function call', async () => {
			functions.addFunctionClass(TestFunctions);
			const planWithErroredCode = PYTHON_CODE_PLAN(PY_TEST_FUNC_THROW_ERROR);

			// Arrange: Mock responses for the agent to enter an error state
			mockLLM
				.addResponse(planWithErroredCode) // 1. Initial plan fails
				.addResponse(ITERATION_SUMMARY_RESPONSE) // 2. Summary for failed iteration
				.addResponse(planWithErroredCode) // 3. Retry plan also fails
				.addResponse(ITERATION_SUMMARY_RESPONSE); // 4. Summary for second failed iteration

			// Act: Start agent and wait for it to enter the error loop
			await startAgent(runConfig({ functions }));
			let agent = await waitForAgent();
			expect(agent).to.exist;
			// The agent would likely be in an 'error' state or re-planning here.

			// Act: Cancel the agent
			await cancelAgent(agent!.agentId, agent!.executionId, 'cancelled by test');
			agent = await waitForAgent();

			// Assert
			expect(agent).to.exist;
			expect(agent!.state).to.equal('completed');
			const functionCallResult = agent!.functionCallHistory.find((call) => call.function_name === SUPERVISOR_CANCELLED_FUNCTION_NAME);
			expect(functionCallResult).to.exist;
			expect(functionCallResult!.stdout).to.equal('cancelled by test');
		});
	});

	describe('LLM calls', () => {
		it.skip('should have the call stack for nested LLM calls', async () => {
			functions.addFunctionClass(TestFunctions);

			// Arrange: Queue all responses
			mockLLM
				.addResponse(SKY_COLOUR_FUNCTION_CALL_PLAN) // 1. Agent plan to call sky_colour
				.addResponse('blue') // 2. LLM response for TestFunctions.skyColour's *internal* LLM call
				.addResponse(ITERATION_SUMMARY_RESPONSE) // 3. Summary for sky_colour iteration
				.addResponse(COMPLETE_FUNCTION_CALL_PLAN) // 4. Agent plan to complete
				.addResponse(ITERATION_SUMMARY_RESPONSE); // 5. Summary for completion iteration

			// Act
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();

			// Assert
			expect(agent).to.exist;
			expect(agent!.state).to.equal('completed');

			const calls = await appContext().llmCallService.getLlmCallsForAgent(agent!.agentId);
			expect(calls.length).to.equal(5);

			// The second call is the one made from *within* the skyColour function
			const skyCall = calls[1];
			// The skyColour method in TestFunctions is responsible for setting the ID 'skyColourId'
			expect(skyCall.callStack).to.equal('TestFunctions.skyColour > generateText skyColourId');
			expect(lastText(skyCall.messages)).to.equal('blue');
		});
	});
});
