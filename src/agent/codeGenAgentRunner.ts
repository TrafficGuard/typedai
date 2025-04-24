import { readFileSync } from 'node:fs';
import { type Span, SpanStatusCode } from '@opentelemetry/api';
import { type PyodideInterface, loadPyodide } from 'pyodide';
import { runAgentCompleteHandler } from '#agent/agentCompletion';
import type { AgentContext } from '#agent/agentContextTypes';
import { AGENT_REQUEST_FEEDBACK, REQUEST_FEEDBACK_PARAM_NAME } from '#agent/agentFeedback';
import { AGENT_COMPLETED_NAME, AGENT_COMPLETED_PARAM_NAME, AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME } from '#agent/agentFunctions';
import { buildFunctionCallHistoryPrompt, buildMemoryPrompt, buildToolStatePrompt, updateFunctionSchemas } from '#agent/agentPromptUtils';
import type { AgentExecution } from '#agent/agentRunner';
import { FUNCTION_OUTPUT_THRESHOLD, SCRIPT_RETURN_VALUE_MAX_TOKENS, summarizeFunctionOutput } from '#agent/agentUtils';
import { reviewPythonCode } from '#agent/codeGenAgentCodeReview';
import { convertJsonToPythonDeclaration, extractPythonCode, removePythonMarkdownWrapper } from '#agent/codeGenAgentUtils';
import { getServiceName } from '#fastify/trace-init/trace-init';
import { FUNC_SEP, type FunctionSchema, getAllFunctionSchemas } from '#functionSchema/functions';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { errorToString } from '#utils/errors';
import { appContext } from '../applicationContext';
import { agentContextStorage, llms } from './agentContextLocalStorage';
import { type HitlCounters, checkHumanInTheLoop } from './humanInTheLoopChecks';

const stopSequences = ['</response>'];

export const CODEGEN_AGENT_SPAN = 'CodeGen Agent';

/** Packages that the agent generated code is allowed to use */
const ALLOWED_PYTHON_IMPORTS = ['json', 're', 'math', 'datetime'];

let pyodide: PyodideInterface;

export async function runCodeGenAgent(agent: AgentContext): Promise<AgentExecution> {
	if (!pyodide) pyodide = await loadPyodide();

	// Hot reload (TODO only when not deployed)
	const codegenSystemPrompt = readFileSync('src/agent/codegen-agent-system-prompt').toString();

	const agentStateService = appContext().agentStateService;
	agent.state = 'agent';

	agentContextStorage.enterWith(agent);

	const agentLLM = llms().hard;

	const userRequestXml = `<user_request>\n${agent.userPrompt}\n</user_request>`;
	let currentPrompt = agent.inputPrompt;
	// logger.info(`userRequestXml ${userRequestXml}`)
	logger.info(`currentPrompt ${currentPrompt}`);

	// Human in the loop settings
	// How often do we require human input to avoid misguided actions and wasting money
	let hilBudget = agent.hilBudget;
	const hilCount = agent.hilCount;

	// Default to $2 budget to avoid accidents
	if (!hilCount && !hilBudget) {
		logger.info('Default Human in the Loop budget to $2');
		hilBudget = 2;
	}

	let hitlCounters: HitlCounters = { iteration: 0, costAccumulated: 0, lastCost: 0 };

	await agentStateService.save(agent);

	const execution: Promise<any> = withActiveSpan(agent.name, async (span: Span) => {
		agent.traceId = span.spanContext().traceId;
		span.setAttributes({
			initialPrompt: agent.inputPrompt,
			'service.name': getServiceName(),
			agentId: agent.agentId,
			executionId: agent.executionId,
			parentId: agent.parentAgentId,
			functions: agent.functions.getFunctionClassNames(),
		});

		let currentFunctionHistorySize = agent.functionCallHistory.length;

		let shouldContinue = true;
		while (shouldContinue) {
			shouldContinue = await withActiveSpan(CODEGEN_AGENT_SPAN, async (span) => {
				agent.callStack = [];
				// Might need to reload the agent for dynamic updating of the tools
				const functionsXml = convertJsonToPythonDeclaration(getAllFunctionSchemas(agent.functions.getFunctionInstances()));
				const systemPromptWithFunctions = updateFunctionSchemas(codegenSystemPrompt, functionsXml);

				let completed = false;
				let requestFeedback = false;
				const anyFunctionCallErrors = false;
				let controlError = false;
				try {
					hitlCounters = await checkHumanInTheLoop(hitlCounters, agent, agentStateService);

					const toolStatePrompt = await buildToolStatePrompt();

					// If the last function was requestFeedback then we'll remove it from function history add it as function results
					let historyToIndex = agent.functionCallHistory.length ? agent.functionCallHistory.length - 1 : 0;
					let requestFeedbackCallResult = '';
					if (agent.functionCallHistory.length && agent.functionCallHistory.at(-1).function_name === AGENT_REQUEST_FEEDBACK) {
						historyToIndex--;
						requestFeedbackCallResult = buildFunctionCallHistoryPrompt('results', 10000, historyToIndex + 1, historyToIndex + 2);
					}
					const oldFunctionCallHistory = buildFunctionCallHistoryPrompt('history', 10000, 0, historyToIndex);

					const isNewAgent = agent.iterations === 0 && agent.functionCallHistory.length === 0;
					// For the initial prompt we create the empty memory, functional calls and default tool state content. Subsequent iterations already have it
					const initialPrompt = isNewAgent
						? oldFunctionCallHistory + buildMemoryPrompt() + toolStatePrompt + currentPrompt
						: currentPrompt + requestFeedbackCallResult;

					let agentPlanResponse: string;
					let llmPythonCode: string;
					try {
						agentPlanResponse = await agentLLM.generateText(systemPromptWithFunctions, initialPrompt, {
							id: 'Codegen agent plan',
							stopSequences,
							temperature: 0.5,
							thinking: 'medium',
						});
						llmPythonCode = extractPythonCode(agentPlanResponse);
					} catch (e) {
						logger.warn(e, 'Error with Codegen agent plan');
						// One re-try if the generate fails or the code can't be extracted
						agentPlanResponse = await agentLLM.generateText(systemPromptWithFunctions, initialPrompt, {
							id: 'Codegen agent plan retry',
							stopSequences,
							temperature: 0.5,
							thinking: 'medium',
						});
						llmPythonCode = extractPythonCode(agentPlanResponse);
					}

					// Review the generated function calling code
					llmPythonCode = await reviewPythonCode(agentPlanResponse, functionsXml);

					agent.state = 'functions';
					await agentStateService.save(agent);

					let pythonScriptResult: any;
					let pythonScript = '';

					const functionInstances: Record<string, object> = agent.functions.getFunctionInstanceMap();
					const funcSchemas: FunctionSchema[] = getAllFunctionSchemas(Object.values(functionInstances));
					const jsGlobals = {};
					for (const schema of funcSchemas) {
						const [className, method] = schema.name.split(FUNC_SEP);
						jsGlobals[schema.name] = async (...args) => {
							// logger.info(`args ${JSON.stringify(args)}`); // Can be very verbose
							// The system prompt instructs the generated code to use positional arguments.
							// however the generated code may use keyword args so we need to handle that case too.

							// Un-proxy any JsProxy objects. https://pyodide.org/en/stable/usage/type-conversions.html
							args = args.map((arg) => (typeof arg?.toJs === 'function' ? arg.toJs() : arg));

							let finalArgs: any[]; // This will hold the arguments in the correct positional order for the JS call
							const parameters: { [key: string]: any } = {}; // For logging history

							const expectedParamNames = schema.parameters.map((p) => p.name);

							// --- Argument Handling Logic ---
							let isKeywordArgs = false;
							// Check if the call *looks* like keyword arguments:
							// 1. Exactly one argument was received from Pyodide.
							// 2. That argument, after .toJs(), is a plain JavaScript object (not null, not an array).
							// 3. The keys of that object are all valid parameter names for the target function.
							if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
								const potentialKwargs = args[0];
								const receivedKeys = Object.keys(potentialKwargs);

								// Check if *all* received keys are actual parameter names for this function
								// AND ensure there's at least one key (don't treat {} as kwargs)
								if (receivedKeys.length > 0 && receivedKeys.every((key) => expectedParamNames.includes(key))) {
									isKeywordArgs = true;
									logger.debug(`Detected keyword arguments for ${schema.name}: ${JSON.stringify(potentialKwargs)}`);
								}
							}

							if (isKeywordArgs) {
								const keywordArgs = args[0];
								finalArgs = [];
								// Reconstruct the arguments array in the order defined by the schema
								for (const paramSchema of schema.parameters) {
									const paramName = paramSchema.name;
									// Get the value from the keyword args object, use undefined if missing
									finalArgs.push(keywordArgs[paramName]);
									// Populate parameters for logging history (only include provided keys)
									if (Object.hasOwn(keywordArgs, paramName)) {
										parameters[paramName] = keywordArgs[paramName];
									}
								}
							} else {
								// Assume positional arguments - use args directly
								finalArgs = args;
								logger.debug(`Assuming positional arguments for ${schema.name}: ${JSON.stringify(finalArgs)}`);
								// Populate parameters for logging history based on position
								for (let i = 0; i < finalArgs.length; i++) {
									if (expectedParamNames[i]) {
										// Check if a parameter name exists for this position
										parameters[expectedParamNames[i]] = finalArgs[i];
									} else {
										// Handle extra positional args if necessary (though generally discouraged)
										parameters[`arg_${i}`] = finalArgs[i]; // Log as generic arg_N
									}
								}
							}
							// --- End Argument Handling Logic ---
							try {
								const functionResponse = await functionInstances[className][method](...finalArgs);
								// To minimise the function call history size becoming too large (i.e. expensive)
								// we'll create a summary for responses which are quite long
								// const outputSummary = await summariseLongFunctionOutput(functionResponse)

								// Don't need to duplicate the content in the function call history
								// TODO Would be nice to save over-written memory keys for history/debugging
								let stdout = JSON.stringify(functionResponse);
								if (className === 'Agent' && method === 'saveMemory') parameters[AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME] = '(See <memory> entry)';
								if (className === 'Agent' && method === 'getMemory') stdout = '(See <memory> entry)';

								if (stdout && stdout.length > FUNCTION_OUTPUT_THRESHOLD) {
									stdout = await summarizeFunctionOutput(agent, agentPlanResponse, schema, parameters, stdout);
								}

								agent.functionCallHistory.push({
									function_name: schema.name,
									parameters,
									stdout,
									// stdoutSummary: outputSummary, TODO
								});
								return functionResponse;
							} catch (e) {
								logger.warn(e, 'Error calling function');
								let stderr = errorToString(e, false);
								if (stderr.length > FUNCTION_OUTPUT_THRESHOLD) {
									stderr = await summarizeFunctionOutput(agent, agentPlanResponse, schema, parameters, stderr);
								}
								agent.functionCallHistory.push({
									function_name: schema.name,
									parameters,
									stderr,
									// stderrSummary: outputSummary, TODO
								});
								throw e;
							}
						};
					}
					const globals = pyodide.toPy(jsGlobals);

					pyodide.setStdout({
						batched: (output) => {
							logger.info(`Script stdout: ${JSON.stringify(output)}`);
						},
					});
					pyodide.setStderr({
						batched: (output) => {
							logger.info(`Script stderr: ${JSON.stringify(output)}`);
						},
					});
					logger.info(`llmPythonCode: ${llmPythonCode}`);
					// Add the imports from the allowed packages being used in the script
					pythonScript = ALLOWED_PYTHON_IMPORTS.filter((pkg) => llmPythonCode.includes(`${pkg}.`) || pkg === 'json') // always need json for JsProxyEncoder
						.map((pkg) => `import ${pkg}\n`)
						.join('\n');

					pythonScript += `
from typing import Any, List, Dict, Tuple, Optional, Union
from pyodide.ffi import JsProxy

class JsProxyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, JsProxy):
            return obj.to_py()
        # Let the base class default method raise the TypeError
        return super().default(obj)

async def main():
${llmPythonCode
	.split('\n')
	.map((line) => `    ${line}`)
	.join('\n')}

main()`.trim();
					let pythonError: Error | null = null;
					try {
						try {
							// Initial execution attempt
							const result = await pyodide.runPythonAsync(pythonScript, { globals });
							pythonScriptResult = result?.toJs ? result.toJs() : result;
							pythonScriptResult = JSON.stringify(pythonScriptResult);
							if (result?.destroy) result.destroy();
						} catch (e) {
							// Attempt to fix Syntax/indentation errors and retry
							// Otherwise let execution errors re-throw.
							if (e.type === 'IndentationError' || e.type === 'SyntaxError') {
								// Fix the compile issues in the script
								const prompt = `${functionsXml}\n<python>\n${pythonScript}</python>\n<error>${e.message}</error>\nPlease adjust/reformat the Python script to fix the issue. Output only the updated code. Do no chat, do not output markdown ticks. Only the updated code.`;
								pythonScript = await llms().hard.generateText(prompt, { id: 'Fix python script error' });
								pythonScript = removePythonMarkdownWrapper(pythonScript);

								// Re-try execution of fixed syntax/indentation error
								const result = await pyodide.runPythonAsync(pythonScript, { globals });
								pythonScriptResult = result?.toJs ? result.toJs() : result;
								pythonScriptResult = JSON.stringify(pythonScriptResult);
								if (result?.destroy) result.destroy();
							} else {
								throw e;
							}
						}
						logger.info(pythonScriptResult, 'Script result');
						if (typeof pythonScriptResult === 'object') {
							for (const [k, v] of Object.entries(pythonScriptResult)) {
								const value = JSON.stringify(v);
								const tokens = await countTokens(JSON.stringify(v));
								if (tokens > SCRIPT_RETURN_VALUE_MAX_TOKENS) {
									logger.warn(`Truncated return value for ${k}`);
									const newLength = Number.parseInt((SCRIPT_RETURN_VALUE_MAX_TOKENS * 3.5).toFixed(0));
									if (newLength > value.length) {
										pythonScriptResult[k] = `${value.substring(0, newLength)}... (truncated due to size)`;
									}
								}
							}
						}

						pythonScriptResult = JSON.stringify(pythonScriptResult);
						// logger.info(pythonScriptResult, 'Script result');
						// If execution succeeds reset error tracking:
					} catch (e) {
						const lineNumber = extractLineNumber(e.message);
						const line = lineNumber ? ` on line "${pythonScript.split('\n')[lineNumber]}"` : '';
						logger.info(e, `Caught python script error${line}. ${e.message}`);
						pythonError = e;
						functionErrorCount++;
					}

					const lastFunctionCall = agent.functionCallHistory.length ? agent.functionCallHistory[agent.functionCallHistory.length - 1] : null;
					logger.info(`Last function call was ${lastFunctionCall?.function_name}`);
					// Should force completed/requestFeedback to exit the script - throw a particular Error class
					if (lastFunctionCall?.function_name === AGENT_COMPLETED_NAME) {
						logger.info(`Task completed: ${lastFunctionCall.parameters[AGENT_COMPLETED_PARAM_NAME]}`);
						agent.state = 'completed';
						completed = true;
					} else if (lastFunctionCall?.function_name === AGENT_REQUEST_FEEDBACK) {
						logger.info(`Feedback requested: ${lastFunctionCall.parameters[REQUEST_FEEDBACK_PARAM_NAME]}`);
						agent.state = 'hitl_feedback';
						requestFeedback = true;
					} else {
						if (!anyFunctionCallErrors && !completed && !requestFeedback) agent.state = 'agent';
					}

					// Function invocations are complete
					// span.setAttribute('functionCalls', pythonCode.map((functionCall) => functionCall.function_name).join(', '));

					// The agent should store important values in memory
					// functionResults

					// This section is duplicated in the provideFeedback function
					agent.invoking = [];
					const currentFunctionCallHistory = buildFunctionCallHistoryPrompt('results', 10000, currentFunctionHistorySize);

					const scriptResult = pythonError
						? `<python-script>\n${pythonScript}\n</python-script>\n<script-error>\n${pythonError.message}\n</script-error>`
						: `<script-result>${pythonScriptResult}</script-result>`;

					currentPrompt = `${oldFunctionCallHistory}\n${currentFunctionCallHistory}${buildMemoryPrompt()}${toolStatePrompt}\n${userRequestXml}\n${agentPlanResponse}\n${scriptResult}\nReview the results of the script and make any observations about the output/errors, then proceed with the response.`;
					currentFunctionHistorySize = agent.functionCallHistory.length;
				} catch (e) {
					span.setStatus({ code: SpanStatusCode.ERROR, message: e.toString() });
					logger.error(e, 'Control loop error');
					controlError = true;
					agent.state = 'error';
					agent.error = errorToString(e);
				} finally {
					agent.inputPrompt = currentPrompt;
					agent.callStack = [];
					agent.iterations++;
					await agentStateService.save(agent);
				}

				// return if the control loop should continue
				return !(completed || requestFeedback || anyFunctionCallErrors || controlError);
			});
		}

		await runAgentCompleteHandler(agent);
	});
	return { agentId: agent.agentId, execution };
}

function extractLineNumber(text: string): number | null {
	const regex = /File "<exec>", line\s+(\d+), in main/;
	const match = text.match(regex);

	if (match?.[1]) {
		return Number.parseInt(match[1], 10);
	}

	return null;
}
