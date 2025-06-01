import { expect } from 'chai';
import sinon from 'sinon';
import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import {
	type RunAgentConfig,
	SUPERVISOR_CANCELLED_FUNCTION_NAME,
	cancelAgent,
	provideFeedback,
	runAgentAndWait,
	startAgent,
} from '#agent/autonomous/autonomousAgentRunner';
import { convertTypeScriptToPython } from '#agent/autonomous/codegen/codegenAutonomousAgentUtils';
import { AGENT_REQUEST_FEEDBACK, AgentFeedback } from '#agent/autonomous/functions/agentFeedback';
import { AGENT_COMPLETED_NAME, AGENT_SAVE_MEMORY } from '#agent/autonomous/functions/agentFunctions';
import { appContext, initInMemoryApplicationContext } from '#app/applicationContext';
import { TEST_FUNC_NOOP, TEST_FUNC_SKY_COLOUR, TEST_FUNC_SUM, TEST_FUNC_THROW_ERROR, TestFunctions } from '#functions/testFunctions';
import { mockLLM, mockLLMs } from '#llm/services/mock-llm';
import { logger } from '#o11y/logger';
import { setTracer } from '#o11y/trace';
import type { AgentContext } from '#shared/agent/agent.model';
import { lastText } from '#shared/llm/llm.model';
import { setupConditionalLoggerOutput } from '#test/testUtils';
import { sleep } from '#utils/async-utils';
import { agentContextStorage } from '../../agentContextLocalStorage';

const PY_AGENT_COMPLETED = (note: string) => `await ${AGENT_COMPLETED_NAME}("${note}")`;
const PY_AGENT_REQUEST_FEEDBACK = (feedback: string) => `await ${AGENT_REQUEST_FEEDBACK}("${feedback}")`;

const PY_TEST_FUNC_NOOP = `await ${TEST_FUNC_NOOP}()`;
const PY_TEST_FUNC_SKY_COLOUR = `await ${TEST_FUNC_SKY_COLOUR}()`;
const PY_TEST_FUNC_SUM = (num1, num2) => `await ${TEST_FUNC_SUM}(${num1}, ${num2})`;
const PY_TEST_FUNC_THROW_ERROR = `await ${TEST_FUNC_THROW_ERROR}()`;
const PY_SET_MEMORY = (key, content) => `await ${AGENT_SAVE_MEMORY}("${key}", "${content}")`;

const PYTHON_CODE_PLAN = (pythonCode: string) => `<response>\n<plan>Run some code</plan>\n<python-code>${pythonCode}</python-code>\n</response>`;
const REQUEST_FEEDBACK_FUNCTION_CALL_PLAN = (feedback) =>
	`<response>\n<plan>Requesting feedback</plan>\n<python-code>${PY_AGENT_REQUEST_FEEDBACK(feedback)}</python-code>\n</response>`;

const COMPLETE_FUNCTION_CALL_PLAN = `<response>\n<plan>Ready to complete</plan>\n<python-code>${PY_AGENT_COMPLETED('done')}</python-code>\n</response>`;

const ITERATION_SUMMARY_RESPONSE = '';

const NOOP_FUNCTION_CALL_PLAN = `<response>\n<plan>I'm going to call the noop function</plan>\n<python-code>${PY_TEST_FUNC_NOOP}</python-code>\n</response>`;

const SKY_COLOUR_FUNCTION_CALL_PLAN = `<response>\n<plan>Get the sky colour</plan>\n<python-code>${PY_TEST_FUNC_SKY_COLOUR}</python-code>\n</response>`;

function result(contents: string): string {
	return `<result>${contents}</result>`;
}

describe('codegenAgentRunner', () => {
	setupConditionalLoggerOutput();
	const ctx = initInMemoryApplicationContext();

	let functions: LlmFunctionsImpl;
	const AGENT_NAME = 'test';

	function runConfig(runConfig?: Partial<RunAgentConfig>): RunAgentConfig {
		const defaults: RunAgentConfig = {
			agentName: AGENT_NAME,
			initialPrompt: 'test prompt',
			systemPrompt: '<functions></functions>',
			type: 'autonomous',
			subtype: 'codegen',
			llms: mockLLMs(),
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
		setTracer(null, agentContextStorage);
		mockLLM.reset();
		functions = new LlmFunctionsImpl(AgentFeedback);
	});

	afterEach(() => {
		logger.flush();
	});

	describe('test function calling', () => {
		it('should be able to call a function with multiple parameters', async () => {
			functions.addFunctionClass(TestFunctions);
			let initialPrompt: string;
			let secondPrompt: string;
			let finalPrompt: string;
			let code = `${PY_SET_MEMORY('memKey', 'contents')}\nreturn ${PY_TEST_FUNC_SUM(3, 6)}`;
			mockLLM.addResponse(`<response>\n<plan>call sum 3 6</plan>\n<python-code>${code}</python-code>\n</response>`, (p) => {
				initialPrompt = p;
			});

			code = `return ${PY_TEST_FUNC_SUM(42, 42)}`;
			mockLLM.addResponse(`<response>\n<plan>call sum 42 42</plan>\n<python-code>${code}</python-code>\n</response>`, (p) => {
				secondPrompt = p;
			});

			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN, (p) => {
				finalPrompt = p;
			});
			mockLLM.addResponse(result(PY_AGENT_COMPLETED('done')));

			await startAgent(runConfig({ initialPrompt: 'Task is to 3 and 6', functions: functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			// spy on sum
			expect(agent!.state).to.equal('completed');

			// when the second round of the control loop happens the prompt should be
			// <old-function-call-history>
			//<memory>
			// <tool-state>
			// <
			await sleep(100);
			console.log();
			console.log('Initial ===================================');
			console.log(initialPrompt);
			console.log();
			console.log('Second ===================================');
			console.log(secondPrompt);
			console.log();
			console.log('Final ===================================');
			console.log(finalPrompt);
		});
	});

	describe('Agent.complete usage', () => {
		it('should be able to complete on the initial function call', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN); // For the agent's main execution
			mockLLM.addResponse('<summary>Test summary for initial completion.</summary>'); // For the IterationSummary
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.error).to.be.null;
			expect(agent!.state).to.equal('completed');
		});

		it('should be able to complete on the second function call', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(NOOP_FUNCTION_CALL_PLAN); // Iteration 1: Agent action
			mockLLM.addResponse('<summary>Test summary for NOOP action.</summary>'); // Iteration 1: Summary
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN); // Iteration 2: Agent action (complete)
			mockLLM.addResponse('<summary>Test summary for final completion.</summary>'); // Iteration 2: Summary
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(!agent!.error).to.be.true;
			expect(agent!.state).to.equal('completed');
		});
	});

	describe('Agent.requestFeedback usage', () => {
		it('should be able to request feedback', async () => {
			const feedbackNote = 'the feedback XYZ';
			mockLLM.addResponse(REQUEST_FEEDBACK_FUNCTION_CALL_PLAN(feedbackNote));
			mockLLM.addResponse('<summary>Test summary for feedback request.</summary>');
			await startAgent(runConfig({ functions }));
			let agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.functionCallHistory.length).to.equal(1);
			expect(agent!.state).to.equal('hitl_feedback');

			let postFeedbackPrompt: string;
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN, (prompt) => {
				postFeedbackPrompt = prompt;
			});
			mockLLM.addResponse('<summary>Test summary after feedback.</summary>');
			logger.info('Providing feedback...');
			await provideFeedback(agent!.agentId, agent!.executionId, feedbackNote);
			agent = await waitForAgent();
			expect(agent).to.exist;

			// Make sure the agent can see the feedback note
			// TODO check that the note is after the <python-code> block
			// in the function call results.
			// Should have all the calls from that iterations in the results not the history
			expect(postFeedbackPrompt).to.not.be.undefined;
			expect(postFeedbackPrompt).to.include(feedbackNote);
			expect(agent!.state).to.equal('completed');
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
			expect(agent!.error).to.be.null;
			expect(agent!.state).to.equal('completed');
		});
	});

	describe('Function call throws an error', () => {
		it.skip('should continue on if a function throws an error', async () => {
			functions.addFunctionInstance(new TestFunctions(), 'TestFunctions');
			// TODO fix why its throwing a SyntaxError: invalid syntax in the Python execution
			const response = `<response><plan>error</plan><python-code>${PY_TEST_FUNC_THROW_ERROR}</python-code></response>`;
			mockLLM.setResponse(response);

			let nextPrompt: string;
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN, (prompt) => {
				nextPrompt = prompt;
			});

			const id = await runAgentAndWait(runConfig({ functions }));
			const ctx = await appContext().agentStateService.load(id);

			console.log(`Next prompt ===============\n${nextPrompt}`);

			expect(ctx.state).to.equal('completed');
			// expect(ctx.state).to.equal('error');
			// expect(ctx.error).to.include(THROW_ERROR_TEXT);
		});
	});

	describe('Resuming agent', () => {
		describe('Feedback provided', () => {
			it('should resume the agent with the feedback', async () => {
				const feedbackNote = 'the feedback';
				mockLLM.addResponse(REQUEST_FEEDBACK_FUNCTION_CALL_PLAN(feedbackNote));
				await startAgent(runConfig({ functions }));
				let agent = await waitForAgent();
				expect(agent).to.exist;

				mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN);
				await provideFeedback(agent!.agentId, agent!.executionId, feedbackNote);
				agent = await waitForAgent();
				expect(agent).to.exist;

				expect(agent!.state).to.equal('completed');
				const functionCallResult = agent!.functionCallHistory.find((call) => call.function_name === AGENT_REQUEST_FEEDBACK);
				expect(functionCallResult!.stdout).to.equal(feedbackNote);
			});
		});
	});

	describe('Cancel errored agent', () => {
		it.skip('should cancel the agent with note as output of the Supervisor.cancelled function call', async () => {
			functions.addFunctionClass(TestFunctions);
			const planWithErroredCode = PYTHON_CODE_PLAN(PY_TEST_FUNC_THROW_ERROR);
			mockLLM.setResponse(planWithErroredCode); // This is for the agent's first planning phase (uses agent.llms.hard)
			mockLLM.addResponse(ITERATION_SUMMARY_RESPONSE); // This is for the summary call after the first iteration's Python code errors (uses llms().easy)
			// This response is for the 'Codegen agent plan retry' call,
			// which error logs indicated was being made after the initial plan's Python code failed.
			mockLLM.addResponse(PYTHON_CODE_PLAN('pass # Python code does nothing after retry')); // This is for the agent's second planning phase (retry plan) (uses agent.llms.hard)
			// This response is for the 'IterationSummary' call.
			// This call typically occurs at the end of an agent's iteration, especially if an error occurred.
			mockLLM.addResponse(ITERATION_SUMMARY_RESPONSE); // This is for the summary call after the second iteration (uses llms().easy)

			// Add responses for a potential third iteration's plan and retry, plus summary,
			// to prevent errors if the agent attempts to run further before cancellation fully processes.
			mockLLM.addResponse(PYTHON_CODE_PLAN('pass # Iter3 Initial Plan'));
			mockLLM.addResponse(PYTHON_CODE_PLAN('pass # Iter3 Retry Plan'));
			mockLLM.addResponse(ITERATION_SUMMARY_RESPONSE);
			await startAgent(runConfig({ functions }));
			let agent = await waitForAgent();
			expect(agent).to.exist;

			await cancelAgent(agent!.agentId, agent!.executionId, 'cancelled');
			agent = await waitForAgent();
			expect(agent).to.exist;

			expect(agent!.state).to.equal('completed');
			const functionCallResult = agent!.functionCallHistory.find((call) => call.function_name === SUPERVISOR_CANCELLED_FUNCTION_NAME);
			expect(functionCallResult!.stdout).to.equal('cancelled');
		});
	});

	describe('LLM calls', () => {
		// TODO fix this
		it.skip('should have the call stack', async () => {
			functions.addFunctionClass(TestFunctions);
			mockLLM.addResponse(SKY_COLOUR_FUNCTION_CALL_PLAN); // 1. Agent plan to call sky_colour
			mockLLM.addResponse('blue'); // 2. LLM response for TestFunctions.skyColour's internal LLM call
			mockLLM.addResponse('<summary>Test summary after sky colour.</summary>'); // 3. Summary for sky_colour iteration
			mockLLM.addResponse(COMPLETE_FUNCTION_CALL_PLAN); // 4. Agent plan to complete
			mockLLM.addResponse('<summary>Test summary for final completion.</summary>'); // 5. Summary for completion iteration
			await startAgent(runConfig({ functions }));
			const agent = await waitForAgent();
			expect(agent).to.exist;
			expect(agent!.state).to.equal('completed');

			const calls = await appContext().llmCallService.getLlmCallsForAgent(agent!.agentId);
			expect(calls.length).to.equal(5);

			const skyCall = calls[1];
			// skyColour is the TestFunctions method name
			expect(skyCall.callStack).to.equal('skyColour > generateMessage skyColourId');
			expect(lastText(skyCall.messages)).to.equal('blue');
		});
	});
});
