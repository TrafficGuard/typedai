import { readFileSync } from 'node:fs';
import { type Span, SpanStatusCode } from '@opentelemetry/api';
import { type PyodideInterface, loadPyodide } from 'pyodide';
import { runAgentCompleteHandler } from '#agent/agentCompletion';
import type { AgentContext, AutonomousIteration } from '#agent/agentContextTypes';
import { AGENT_REQUEST_FEEDBACK, REQUEST_FEEDBACK_PARAM_NAME } from '#agent/agentFeedback';
import { AGENT_COMPLETED_NAME, AGENT_COMPLETED_PARAM_NAME, AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME } from '#agent/agentFunctions';
import { buildMemoryPrompt, buildToolStateMap, buildToolStatePrompt, updateFunctionSchemas } from '#agent/agentPromptUtils';
import type { AgentExecution } from '#agent/agentRunner';
import { FUNCTION_OUTPUT_THRESHOLD, summarizeFunctionOutput } from '#agent/agentUtils';
import {
	convertJsonToPythonDeclaration,
	extractAgentPlan,
	extractExpandedUserRequest,
	extractNextStepDetails,
	extractObservationsReasoning,
	extractPythonCode,
	removePythonMarkdownWrapper,
} from '#agent/codeGenAgentUtils';
import { cloneAndTruncateBuffers } from '#agent/trimObject';
import { appContext } from '#app/applicationContext';
import { getServiceName } from '#fastify/trace-init/trace-init';
import { FUNC_SEP, type FunctionSchema, getAllFunctionSchemas } from '#functionSchema/functions';
import type { FileStore } from '#functions/storage/filestore';
import { type FunctionCallResult, type ImagePartExt, type LlmMessage, type UserContentExt, system, text, toText, user } from '#llm/llm';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { errorToString } from '#utils/errors';
import { agentContextStorage, llms } from './agentContextLocalStorage';
import { checkForImageSources } from './agentImageUtils'; // Add this import
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

	let hitlCounters: HitlCounters = { iteration: 0, costAccumulated: 0, lastCost: 0 };

	let currentFunctionHistorySize = agent.functionCallHistory.length;

	// Store the agent's response from the previous iteration to include in the next prompt
	let previousAgentPlanResponse = '';
	// Store the script result from the previous iteration
	let previousScriptResult = '';
	// Store image parts detected in the last script result, to be included in the *next* prompt
	let imageParts: ImagePartExt[] = [];

	let shouldContinue = true;
	while (shouldContinue) {
		shouldContinue = await withActiveSpan(CODEGEN_AGENT_SPAN, async (span) => {
			agent.iterations++;

			// Control loop variables
			let completed = false;
			let requestFeedback = false;
			let controlLoopError: Error | null = null;
			let currentImageParts: ImagePartExt[] = []; // Reset image parts for this iteration's script result processing

			const iterationData: Partial<AutonomousIteration> = {
				agentId: agent.agentId,
				iteration: agent.iterations,
				functions: agent.functions.getFunctionClassNames(),
			};

			try {
				hitlCounters = await checkHumanInTheLoop(hitlCounters, agent, agentStateService);

				// Might need to reload the agent for dynamic updating of the tools
				const functionsXml = convertJsonToPythonDeclaration(getAllFunctionSchemas(agent.functions.getFunctionInstances()));
				const systemPromptWithFunctions = updateFunctionSchemas(codegenSystemPrompt, functionsXml);
				const toolStatePrompt = await buildToolStatePrompt();

				// Add function call history (handle potential requestFeedback at the end)
				let historyEndIndex = agent.functionCallHistory.length;
				let requestFeedbackCallResult: FunctionCallResult | null = null;
				if (agent.functionCallHistory.length && agent.functionCallHistory.at(-1).function_name === AGENT_REQUEST_FEEDBACK) {
					historyEndIndex--;
					requestFeedbackCallResult = agent.functionCallHistory[historyEndIndex]; // Get the feedback call
				}

				// Build the agent planning prompt messages
				const agentMessages: LlmMessage[] = [];
				agentMessages.push(system(systemPromptWithFunctions));

				// Build the main control loop prompt message content
				const agentUserMessageContent: UserContentExt = [];
				agentUserMessageContent.push(text(buildMemoryPrompt()));
				if (toolStatePrompt) agentUserMessageContent.push(text(toolStatePrompt));
				agentUserMessageContent.push(text(userRequestXml));

				// Add previous agent response and script result (if not the first iteration)
				if (agent.iterations > 0) {
					agentUserMessageContent.push(text(previousAgentPlanResponse)); // The <response>...</response> block
					agentUserMessageContent.push(text(previousScriptResult)); // The <script-result>...</script-result> or <script-error>...</script-error>
					// Add images detected in the previous script result
					if (imageParts.length > 0) {
						logger.debug(`Adding ${imageParts.length} image(s) from previous iteration to prompt.`);
						agentUserMessageContent.push(...imageParts); // Add images collected at the end of the last loop
					}
				}

				if (requestFeedbackCallResult)
					agentUserMessageContent.push(
						text(`<function-result name="${AGENT_REQUEST_FEEDBACK}">${JSON.stringify(requestFeedbackCallResult)}</function-result>`),
					);

				agentUserMessageContent.push(
					text('Review the results of the script and make any observations about the output/errors, then proceed with the response.'),
				);

				agentMessages.push(user(agentUserMessageContent));

				iterationData.prompt = agentMessages.map(toText).join('\n');
				iterationData.images = imageParts.map((img) => structuredClone(img));

				let agentPlanResponseMessage: LlmMessage;
				try {
					agentPlanResponseMessage = await agent.llms.hard.generateMessage(agentMessages, {
						id: 'Codegen agent plan',
						stopSequences,
						temperature: 0.5,
						thinking: 'medium',
					});
				} catch (e) {
					logger.warn(e, 'Error with Codegen agent plan');
					agentPlanResponseMessage = await agent.llms.hard.generateMessage(agentMessages, {
						id: 'Codegen agent plan retry',
						stopSequences,
						temperature: 0.5,
						thinking: 'medium',
					});
				}
				const agentPlanResponse = toText(agentPlanResponseMessage);
				iterationData.stats = agentPlanResponseMessage.stats;
				iterationData.expandedUserRequest = extractExpandedUserRequest(agentPlanResponse);
				iterationData.observationsReasoning = extractObservationsReasoning(agentPlanResponse);
				iterationData.agentPlan = extractAgentPlan(agentPlanResponse); // Overwrite with extracted plan if found, otherwise keep raw
				iterationData.nextStepDetails = extractNextStepDetails(agentPlanResponse);

				let pythonScriptResult: any;
				let pythonScriptResultString: string | null = null; // To store the stringified result for the next prompt

				// Store for the next iteration's prompt, wrapped in expected tags
				previousAgentPlanResponse = `<response>\n${agentPlanResponse}\n</response>`;

				// Extract the code, compile and fix if required
				let pythonMainFnCode = extractPythonCode(agentPlanResponse);
				pythonMainFnCode = await ensureCorrectSyntax(pythonMainFnCode, functionsXml);
				iterationData.code = pythonMainFnCode;
				const pythonScript = mainFnCodeToFullScript(pythonMainFnCode);

				const currentIterationFunctionCalls: FunctionCallResult[] = [];
				// Configure the objects for the Python global scope which proxy to the available @func class methods
				const globals = setupPyodideFunctionCallableGlobals(agent, agentPlanResponse, currentIterationFunctionCalls);

				await agentStateService.updateState(agent, 'functions');

				try {
					const result = await pyodide.runPythonAsync(pythonScript, { globals });
					// The dict_converter converts to regular JS objects instead of the default Map objects
					pythonScriptResult = result?.toJs ? result.toJs({ dict_converter: Object.fromEntries }) : result;
					if (result?.destroy) result.destroy();

					// --- Check for images BEFORE stringifying/truncating ---
					if (typeof pythonScriptResult === 'object' && pythonScriptResult !== null) {
						// Reset images for this iteration before checking
						currentImageParts = []; // Use a temporary variable for this iteration's images
						const fileStore: FileStore | null = agent.functions.getFunctionType('filestore');
						currentImageParts = await checkForImageSources(pythonScriptResult, fileStore); // Pass result and filestore
						// Store the detected images for the *next* iteration's prompt
						imageParts = currentImageParts;
					} else {
						// If not an object, clear image parts for the next iteration
						imageParts = [];
					}
					pythonScriptResultString = cloneAndTruncateBuffers(pythonScriptResult);

					agent.error = null; // If execution succeeds reset error tracking
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

				// Store the script result string (or error) for the next iteration's prompt
				previousScriptResult = agent.error
					? `<python-script>\n${pythonMainFnCode}\n</python-script>\n<script-error>\n${agent.error}\n</script-error>`
					: `<script-result>${pythonScriptResultString}</script-result>`;

				currentFunctionHistorySize = agent.functionCallHistory.length;
			} catch (e) {
				span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
				controlLoopError = e;
				agent.state = 'error';
				agent.error = errorToString(e);
				iterationData.error = agent.error;
				logger.error(e, 'Control loop error');
			} finally {
				// Capture current memory and tool state before saving
				iterationData.memory = new Map(Object.entries(agent.memory));
				iterationData.toolState = await buildToolStateMap(agent.functions.getFunctionInstances());

				try {
					await Promise.all([agentStateService.save(agent), agentStateService.saveIteration(iterationData as AutonomousIteration)]);
				} catch (e) {
					logger.error(e, 'Error saving agent state in control loop');
					controlLoopError = e;
				}
			}

			const shouldStopExecution = completed || requestFeedback || !!controlLoopError;
			return !shouldStopExecution;
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
from typing import Any, List, Dict, Tuple, Optional, Union, TypedDict, Callable, Iterable, Mapping, Sequence, Set, Final
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
	const MAX_ATTEMPTS = 1;
	for (let i = 1; i <= MAX_ATTEMPTS; i++) {
		const lines = mainFnCodeToFullScript(pythonMainFnCode).split('\n');
		// Strip the main() so nothing executes
		const main = lines.pop();
		if (main !== 'main()') throw new Error('Expected last line to be main()');
		const script = lines.join('\n');
		try {
			await pyodide.runPythonAsync(script, {});
			return pythonMainFnCode;
		} catch (e) {
			if ((e.type !== 'IndentationError' && e.type !== 'SyntaxError') || i === MAX_ATTEMPTS) throw e; // Only expect syntax/indent errors

			// Fix the compile issues in the script
			const prompt = `${functionsXml}\n<python>\n${pythonMainFnCode}</python>\n<error>${e.message}</error>\nPlease adjust/reformat the Python code to fix the issue. Output only the updated code. Do no chat, do not output markdown ticks. Only the updated code.`;
			pythonMainFnCode = await llms().hard.generateText(prompt, { id: 'Fix python script error' });
			pythonMainFnCode = removePythonMarkdownWrapper(pythonMainFnCode);
		}
	}
	return pythonMainFnCode;
}
