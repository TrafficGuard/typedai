import { readFileSync } from 'node:fs';
import { type Span, SpanStatusCode } from '@opentelemetry/api';
import { type PyodideInterface, loadPyodide } from 'pyodide';
import { runAgentCompleteHandler } from '#agent/agentCompletion';
import type { AgentContext, AutonomousIteration } from '#agent/agentContextTypes';
import { AGENT_REQUEST_FEEDBACK, REQUEST_FEEDBACK_PARAM_NAME } from '#agent/agentFeedback';
import { AGENT_COMPLETED_NAME, AGENT_COMPLETED_PARAM_NAME, AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME } from '#agent/agentFunctions';
import { buildFunctionCallHistoryPrompt, buildMemoryPrompt, buildToolStateMap, buildToolStatePrompt, updateFunctionSchemas } from '#agent/agentPromptUtils';
import type { AgentExecution } from '#agent/agentRunner';
import { FUNCTION_OUTPUT_THRESHOLD, SCRIPT_RETURN_VALUE_MAX_TOKENS, summarizeFunctionOutput } from '#agent/agentUtils';
import {
	convertJsonToPythonDeclaration,
	extractAgentPlan,
	extractExpandedUserRequest,
	extractNextStepDetails,
	extractObservationsReasoning,
	extractPythonCode,
	removePythonMarkdownWrapper,
} from '#agent/codeGenAgentUtils';
import { appContext } from '#app/applicationContext';
import { getServiceName } from '#fastify/trace-init/trace-init';
import { FUNC_SEP, type FunctionSchema, getAllFunctionSchemas } from '#functionSchema/functions';
import type { FunctionCallResult } from '#llm/llm';
import { countTokens } from '#llm/tokens';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { errorToString } from '#utils/errors';
import { agentContextStorage, llms } from './agentContextLocalStorage';
import { type HitlCounters, checkHumanInTheLoop } from './humanInTheLoopChecks';

const stopSequences = ['</response>'];

export const CODEGEN_AGENT_SPAN = 'CodeGen Agent';

/** Packages that the agent generated code is allowed to use */
const ALLOWED_PYTHON_IMPORTS = ['json', 're', 'math', 'datetime'];

let pyodide: PyodideInterface;
let codegenSystemPrompt: string | null = null;

export async function runCodeGenAgent(agent: AgentContext): Promise<AgentExecution> {
	pyodide ??= await initPyodide();
	codegenSystemPrompt ??= readFileSync('src/agent/codegen-agent-system-prompt').toString();

	const agentStateService = appContext().agentStateService;
	agent.state = 'agent';
	await agentStateService.save(agent);

	agentContextStorage.enterWith(agent);

	const execution = withActiveSpan(agent.name, async (span: Span) => runAgentExecution(agent, span));
	return { agentId: agent.agentId, execution };
}

async function runAgentExecution(agent: AgentContext, span: Span): Promise<string> {
	agent.traceId = span.spanContext().traceId;
	span.setAttributes({
		initialPrompt: agent.inputPrompt,
		'service.name': getServiceName(),
		agentId: agent.agentId,
		executionId: agent.executionId,
		parentId: agent.parentAgentId,
		functions: agent.functions.getFunctionClassNames(),
	});

	agentContextStorage.enterWith(agent);
	const agentStateService = appContext().agentStateService;
	const userRequestXml = `<user_request>\n${agent.userPrompt}\n</user_request>`;
	let currentPrompt = agent.inputPrompt;
	logger.info(`currentPrompt ${currentPrompt}`);

	let hitlCounters: HitlCounters = { iteration: 0, costAccumulated: 0, lastCost: 0 };

	let currentFunctionHistorySize = agent.functionCallHistory.length;

	let shouldContinue = true;
	while (shouldContinue) {
		shouldContinue = await withActiveSpan(CODEGEN_AGENT_SPAN, async (span) => {
			agent.iterations++;

			// Control loop variables
			let completed = false;
			let requestFeedback = false;
			let controlLoopError: Error | null = null;

			const iterationData: Partial<AutonomousIteration> = {
				agentId: agent.agentId,
				iteration: agent.iterations + 1, // Iteration number for this loop run
				functions: agent.functions.getFunctionClassNames(),
			};

			try {
				hitlCounters = await checkHumanInTheLoop(hitlCounters, agent, agentStateService);

				// Build the prompt ----------
				// Might need to reload the agent for dynamic updating of the tools
				const functionsXml = convertJsonToPythonDeclaration(getAllFunctionSchemas(agent.functions.getFunctionInstances()));
				const systemPromptWithFunctions = updateFunctionSchemas(codegenSystemPrompt, functionsXml);
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
				iterationData.prompt = initialPrompt;
				// -----

				let agentPlanResponse: string;
				let pythonMainFnCode: string;
				let pythonScript: string;
				let pythonScriptResult: any;

				try {
					agentPlanResponse = await agent.llms.hard.generateText(systemPromptWithFunctions, initialPrompt, {
						id: 'Codegen agent plan',
						stopSequences,
						temperature: 0.5,
						thinking: 'medium',
					});
				} catch (e) {
					logger.warn(e, 'Error with Codegen agent plan');
					// One re-try if the generate fails or the code can't be extracted
					agentPlanResponse = await agent.llms.hard.generateText(systemPromptWithFunctions, initialPrompt, {
						id: 'Codegen agent plan retry',
						stopSequences,
						temperature: 0.5,
						thinking: 'medium',
					});
				}
				// Save the raw response before extracting parts
				// iterationData.agentPlan = agentPlanResponse;

				// Extract specific parts from the agent's response
				iterationData.expandedUserRequest = extractExpandedUserRequest(agentPlanResponse);
				iterationData.observationsReasoning = extractObservationsReasoning(agentPlanResponse);
				iterationData.agentPlan = extractAgentPlan(agentPlanResponse); // Overwrite with extracted plan if found, otherwise keep raw
				iterationData.nextStepDetails = extractNextStepDetails(agentPlanResponse);

				pythonMainFnCode = extractPythonCode(agentPlanResponse);
				pythonMainFnCode = await ensureCorrectSyntax(pythonMainFnCode, functionsXml);
				iterationData.code = pythonMainFnCode;
				pythonScript = mainFnCodeToFullScript(pythonMainFnCode);

				const currentIterationFunctionCalls: FunctionCallResult[] = [];
				const globals = setupPyodideFunctionCallableGlobals(agent, agentPlanResponse, currentIterationFunctionCalls);

				agent.state = 'functions';
				await agentStateService.save(agent);

				try {
					const result = await pyodide.runPythonAsync(pythonScript, { globals });
					pythonScriptResult = result?.toJs ? result.toJs() : result;
					if (result?.destroy) result.destroy();

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
					agent.error = null;
				} catch (e) {
					const lineNumber = extractLineNumber(e.message);
					const line = lineNumber ? ` on line "${pythonScript.split('\n')[lineNumber]}"` : '';
					logger.info(e, `Caught python script error${line}. ${e.message}`);
					const errorString = errorToString(e);
					iterationData.error = errorString;
					agent.error = errorString;
				} finally {
					iterationData.functionCalls = currentIterationFunctionCalls;
				}

				const lastFunctionCall = agent.functionCallHistory.length ? agent.functionCallHistory[agent.functionCallHistory.length - 1] : null;
				logger.info(`Last function call was ${lastFunctionCall?.function_name}`);
				// Check for agent completion or feedback request
				if (lastFunctionCall?.function_name === AGENT_COMPLETED_NAME) {
					logger.info(`Task completed: ${lastFunctionCall.parameters[AGENT_COMPLETED_PARAM_NAME]}`);
					agent.state = 'completed';
					completed = true;
				} else if (lastFunctionCall?.function_name === AGENT_REQUEST_FEEDBACK) {
					logger.info(`Feedback requested: ${lastFunctionCall.parameters[REQUEST_FEEDBACK_PARAM_NAME]}`);
					agent.state = 'hitl_feedback';
					requestFeedback = true;
				}

				const currentFunctionCallHistory = buildFunctionCallHistoryPrompt('results', 10000, currentFunctionHistorySize);

				const scriptResult = agent.error
					? `<python-script>\n${pythonMainFnCode}\n</python-script>\n<script-error>\n${agent.error}\n</script-error>`
					: `<script-result>${pythonScriptResult}</script-result>`;

				currentPrompt = `${oldFunctionCallHistory}\n${currentFunctionCallHistory}${buildMemoryPrompt()}${toolStatePrompt}\n${userRequestXml}\n${agentPlanResponse}\n${scriptResult}\nReview the results of the script and make any observations about the output/errors, then proceed with the response.`;
				agent.inputPrompt = currentPrompt;
				currentFunctionHistorySize = agent.functionCallHistory.length;
			} catch (e) {
				span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
				controlLoopError = e;
				agent.state = 'error';
				agent.error = errorToString(e);
				iterationData.error = agent.error;
				logger.error(e, 'Control loop error');
			} finally {
				// Capture memory and tool state before saving
				iterationData.memory = new Map(Object.entries(agent.memory)); // Convert Record to Map
				iterationData.toolState = await buildToolStateMap(agent.functions.getFunctionInstances()); // Capture tool state

				try {
					await Promise.all([agentStateService.save(agent), agentStateService.saveIteration(iterationData as AutonomousIteration)]);
				} catch (e) {
					logger.error(e, 'Error saving agent state in control loop');
					controlLoopError = e;
				}
			}

			// return if the control loop should continue
			return !(completed || requestFeedback || controlLoopError);
		});
	}

	await runAgentCompleteHandler(agent);
	return agent.agentId;
}

function extractLineNumber(text: string): number | null {
	const regex = /File "<exec>", line\s+(\d+), in main/;
	const match = text.match(regex);

	if (match?.[1]) {
		return Number.parseInt(match[1], 10);
	}

	return null;
}

/**
 * Converts the python code produced by the agent LLM to the complete script which will be executed
 * @param pythonMainFnCode python code
 */
function mainFnCodeToFullScript(pythonMainFnCode: string): string {
	// Add the imports from the allowed packages being used in the script
	let pythonScript = ALLOWED_PYTHON_IMPORTS.filter((pkg) => pythonMainFnCode.includes(`${pkg}.`) || pkg === 'json') // always need json for JsProxyEncoder
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
${pythonMainFnCode
	.split('\n')
	.map((line) => `    ${line}`)
	.join('\n')}

main()`.trim();
	return pythonScript;
}

function setupPyodideFunctionCallableGlobals(agent: AgentContext, agentPlanResponse: string, currentIterationFunctionCalls: FunctionCallResult[]) {
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
			// Un-proxy any Pyodide proxied objects
			for (const [k, v] of Object.entries(parameters)) {
				if (v?.toJs) parameters[k] = v.toJs();
			}
			finalArgs = finalArgs.map((arg) => (arg?.toJs ? arg.toJs() : arg));

			try {
				const functionResponse = await functionInstances[className][method](...finalArgs);
				// Don't need to duplicate the content in the function call history
				// TODO Would be nice to save over-written memory keys for history/debugging
				let stdout = JSON.stringify(functionResponse);
				if (className === 'Agent' && method === 'saveMemory') parameters[AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME] = '(See <memory> entry)';
				if (className === 'Agent' && method === 'getMemory') stdout = '(See <memory> entry)';

				if (stdout && stdout.length > FUNCTION_OUTPUT_THRESHOLD) {
					stdout = await summarizeFunctionOutput(agent, agentPlanResponse, schema, parameters, stdout);
				}

				const functionCallResult: FunctionCallResult = {
					function_name: schema.name,
					parameters,
					stdout,
					// stdoutSummary: outputSummary, TODO
				};
				agent.functionCallHistory.push(functionCallResult);
				currentIterationFunctionCalls.push(functionCallResult);
				return functionResponse;
			} catch (e) {
				logger.warn(e, 'Error calling function');
				let stderr = errorToString(e, false);
				if (stderr.length > FUNCTION_OUTPUT_THRESHOLD) {
					stderr = await summarizeFunctionOutput(agent, agentPlanResponse, schema, parameters, stderr);
				}
				const functionCallResult: FunctionCallResult = {
					function_name: schema.name,
					parameters,
					stderr,
					// stderrSummary: outputSummary, TODO
				};
				agent.functionCallHistory.push(functionCallResult);
				currentIterationFunctionCalls.push(functionCallResult);
				throw e;
			}
		};
	}
	return pyodide.toPy(jsGlobals);
}

async function initPyodide(): Promise<PyodideInterface> {
	pyodide = await loadPyodide();
	pyodide.setDebug(true);
	pyodide.setStdout({
		batched: (output) => {
			logger.info(`CodeGen stdout: ${JSON.stringify(output)}`);
		},
	});
	pyodide.setStderr({
		batched: (output) => {
			logger.info(`CodeGen stderr: ${JSON.stringify(output)}`);
		},
	});
	return pyodide;
}

async function ensureCorrectSyntax(pythonMainFnCode: string, functionsXml: string): Promise<string> {
	const MAX_ATTEMPTS = 2;
	for (let i = 1; i < MAX_ATTEMPTS; i++) {
		const lines = mainFnCodeToFullScript(pythonMainFnCode).split('\n');
		// Strip the main() so nothing executes
		const main = lines.pop();
		if (main !== 'main()') throw new Error('Expected last line to be main()');
		const script = lines.join('\n');
		try {
			await pyodide.runPythonAsync(script, {});
			return pythonMainFnCode;
		} catch (e) {
			console.log(script);
			console.log(e);
			if ((e.type !== 'IndentationError' && e.type !== 'SyntaxError') || i === MAX_ATTEMPTS) throw e; // Only expect syntax/indent errors

			// Fix the compile issues in the script
			const prompt = `${functionsXml}\n<python>\n${pythonMainFnCode}</python>\n<error>${e.message}</error>\nPlease adjust/reformat the Python code to fix the issue. Output only the updated code. Do no chat, do not output markdown ticks. Only the updated code.`;
			pythonMainFnCode = await llms().hard.generateText(prompt, { id: 'Fix python script error' });
			pythonMainFnCode = removePythonMarkdownWrapper(pythonMainFnCode);
		}
	}
}
