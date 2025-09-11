import { readFileSync } from 'node:fs';
import { type Span, SpanStatusCode } from '@opentelemetry/api';
import { type PyodideInterface, loadPyodide } from 'pyodide';
import {
	buildFileSystemTreePrompt,
	buildFunctionCallHistoryPrompt,
	buildMemoryPrompt,
	buildToolStateMap,
	buildToolStatePrompt,
	updateFunctionSchemas,
} from '#agent/agentPromptUtils';
import { FUNCTION_OUTPUT_THRESHOLD, summarizeFunctionOutput } from '#agent/agentUtils';
import { runAgentCompleteHandler } from '#agent/autonomous/agentCompletion';
import type { AgentExecution } from '#agent/autonomous/autonomousAgentRunner';
import {
	extractAgentPlan,
	extractCodeReview,
	extractExpandedUserRequest,
	extractNextStepDetails,
	extractObservationsReasoning,
} from '#agent/autonomous/codegen/codegenAutonomousAgentUtils';
import { AGENT_REQUEST_FEEDBACK, REQUEST_FEEDBACK_PARAM_NAME } from '#agent/autonomous/functions/agentFeedback';
import { AGENT_COMPLETED_NAME, AGENT_COMPLETED_PARAM_NAME, AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME } from '#agent/autonomous/functions/agentFunctions';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { ForceStopError } from '#agent/forceStopAgent';
import { cloneAndTruncateBuffers, removeConsoleEscapeChars } from '#agent/trimObject';
import { appContext } from '#app/applicationContext';
import { getServiceName } from '#fastify/trace-init/trace-init';
import { FUNC_SEP, type FunctionSchema, getAllFunctionSchemas } from '#functionSchema/functions';
import type { FileStore } from '#functions/storage/filestore';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { AgentContext, AutonomousIteration, LLM } from '#shared/agent/agent.model';
import { FILE_STORE_NAME, type FileMetadata } from '#shared/files/files.model';
import { type FunctionCallResult, type ImagePartExt, type LlmMessage, type UserContentExt, messageText, system, text, user } from '#shared/llm/llm.model';
import { errorToString } from '#utils/errors';
import { CDATA_END, CDATA_START } from '#utils/xml-utils';
import { agentContext, agentContextStorage, llms } from '../../agentContextLocalStorage';
import { type HitlCounters, checkHumanInTheLoop } from '../humanInTheLoopChecks';
import { checkForImageSources } from './agentImageUtils';
import {
	convertJsonToPythonDeclaration,
	extractDraftPythonCode,
	extractPythonCode,
	mainFnCodeToFullScript,
	processFunctionArguments,
	removePythonMarkdownWrapper,
} from './pythonCodeGenUtils';

const stopSequences = undefined; //['</response>']; grok4 does not support stop sequences

const AGENT_TEMPERATURE = 0.6;

// Thresholds for content size (in bytes)
const LARGE_OUTPUT_THRESHOLD_BYTES = 50 * 1024; // 50KB
const MAX_PROMPT_TAG_CONTENT_BYTES = 1024; // Max length for summary in <script-result/error> tag

const PREVIOUS_SCRIPT_RESULT_VAR = 'PREVIOUS_SCRIPT_RESULT';
const PREVIOUS_SCRIPT_ERROR_VAR = 'PREVIOUS_SCRIPT_ERROR';

export const CODEGEN_AGENT_SPAN = 'CodeGen Agent';

let pyodide: PyodideInterface;
let codegenSystemPrompt: string | null = null;

const PYODIDE_LOG_DEBOUNCE_MS = 100;

interface AgentLogBuffer {
	buffer: string[];
	timer: NodeJS.Timeout | null;
}

const agentStdoutBuffers = new Map<string, AgentLogBuffer>();
const agentStderrBuffers = new Map<string, AgentLogBuffer>();

export async function runCodeGenAgent(agent: AgentContext): Promise<AgentExecution> {
	pyodide ??= await initPyodide();
	codegenSystemPrompt ??= readFileSync('src/agent/autonomous/codegen/codegen-agent-system-prompt').toString();

	const agentStateService = appContext().agentStateService;
	agent.state = 'agent';
	await agentStateService.save(agent);

	agentContextStorage.enterWith(agent);

	const executionPromise = withActiveSpan(agent.name, async (span: Span) => runAgentExecution(agent, span));

	// Ensure cleanup happens after the execution promise settles
	const executionWithCleanup = executionPromise.finally(() => {
		cleanupAgentPyodideLogs(agent.agentId);
	});

	return { agentId: agent.agentId, execution: executionWithCleanup };
}

async function runAgentExecution(agent: AgentContext, span: Span): Promise<string> {
	codegenSystemPrompt ??= readFileSync('src/agent/autonomous/codegen/codegen-agent-system-prompt').toString();
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
	// Initialize globals for the first iteration so the variables always exist
	let pyGlobalsForNextScriptExecution: Record<string, any> = {
		[PREVIOUS_SCRIPT_RESULT_VAR]: '',
		[PREVIOUS_SCRIPT_ERROR_VAR]: '',
	};

	let shouldContinue = true;
	while (shouldContinue) {
		shouldContinue = await withActiveSpan(CODEGEN_AGENT_SPAN, async (span) => {
			agent.iterations++;

			// Control loop variables
			let completed = false;
			let agentRequestedFeedbackFlag = false;
			let uiRequestedHilFlag = false;
			let controlLoopError: Error | null = null;
			let currentImageParts: ImagePartExt[] = []; // Reset image parts for this iteration's script result processing

			const initialCost = agent.cost;

			const iterationData: Partial<AutonomousIteration> = {
				agentId: agent.agentId,
				iteration: agent.iterations,
				functions: agent.functions.getFunctionClassNames(),
			};

			try {
				hitlCounters = await checkHumanInTheLoop(hitlCounters, agent, agentStateService);

				// Might need to reload the agent for dynamic updating of the tools
				const functionsXml = convertJsonToPythonDeclaration(getAllFunctionSchemas(agent.functions.getFunctionInstances()));
				const systemPromptWithFunctions = updateFunctionSchemas(codegenSystemPrompt!, functionsXml);
				const fileSystemTreePrompt = await buildFileSystemTreePrompt();
				const toolStatePrompt = await buildToolStatePrompt();

				// Add function call history (handle potential requestFeedback at the end)
				let historyEndIndex = agent.functionCallHistory.length;
				let requestFeedbackCallResult: FunctionCallResult | null = null;
				if (agent.functionCallHistory.length && agent.functionCallHistory.at(-1)!.function_name === AGENT_REQUEST_FEEDBACK) {
					historyEndIndex--;
					requestFeedbackCallResult = agent.functionCallHistory[historyEndIndex]!; // Get the feedback call
				}

				// Build the agent planning prompt messages
				const agentMessages: LlmMessage[] = [];
				agentMessages.push(system(systemPromptWithFunctions));

				// Build the main control loop prompt message content
				const agentUserMessageContent: UserContentExt = [];
				if (fileSystemTreePrompt) agentUserMessageContent.push(text(fileSystemTreePrompt));
				agentUserMessageContent.push(text(buildFunctionCallHistoryPrompt('history', 20000, 0, historyEndIndex)));
				agentUserMessageContent.push(text(await buildMemoryPrompt()));
				if (toolStatePrompt) agentUserMessageContent.push(text(toolStatePrompt));
				agentUserMessageContent.push(text(userRequestXml));

				// Add previous agent response and script result (if not the first iteration)
				if (previousAgentPlanResponse) agentUserMessageContent.push(text(previousAgentPlanResponse)); // The <response>...</response> block
				if (previousScriptResult) agentUserMessageContent.push(text(previousScriptResult)); // The <script-result>...</script-result> or <script-error>...</script-error>
				// Add images detected in the previous script result
				if (imageParts.length > 0) {
					logger.debug(`Adding ${imageParts.length} image(s) from previous iteration to prompt.`);
					agentUserMessageContent.push(...imageParts); // Add images collected at the end of the last loop
				}

				if (requestFeedbackCallResult)
					agentUserMessageContent.push(
						text(`<function-result name="${AGENT_REQUEST_FEEDBACK}">${JSON.stringify(requestFeedbackCallResult)}</function-result>`),
					);

				if (previousScriptResult)
					agentUserMessageContent.push(
						text('Review the results of the script and make any observations about the output/errors, then proceed with the response.'),
					);

				logger.debug({ finalAgentUserMessageContent: agentUserMessageContent }, 'Final user message content before creating user message');
				agentMessages.push(user(agentUserMessageContent));

				iterationData.prompt = agentMessages.map(messageText).join('\n');
				iterationData.images = imageParts.map((img) => structuredClone(img));

				let agentPlanResponseMessage: LlmMessage;
				let agentPlanResponse: string;
				let pythonMainFnCode: string; // As long as we can extract the code we can do an iteration
				try {
					agentPlanResponseMessage = await agentLLM.generateMessage(agentMessages, {
						id: 'Codegen agent plan',
						stopSequences,
						temperature: AGENT_TEMPERATURE,
						thinking: 'high',
						maxOutputTokens: 32000,
					});
					agentPlanResponse = messageText(agentPlanResponseMessage);
					pythonMainFnCode = extractPythonCode(agentPlanResponse);
				} catch (e) {
					logger.warn(e, 'Error with Codegen agent plan');
					agentPlanResponseMessage = await agentLLM.generateMessage(agentMessages, {
						id: 'Codegen agent plan retry',
						stopSequences,
						temperature: AGENT_TEMPERATURE,
						thinking: 'high',
						maxOutputTokens: 32000,
					});
					agentPlanResponse = messageText(agentPlanResponseMessage);
					pythonMainFnCode = extractPythonCode(agentPlanResponse);
				}
				iterationData.response = agentPlanResponse;
				iterationData.stats = agentPlanResponseMessage.stats;
				iterationData.expandedUserRequest = extractExpandedUserRequest(agentPlanResponse);
				iterationData.observationsReasoning = extractObservationsReasoning(agentPlanResponse);
				iterationData.agentPlan = extractAgentPlan(agentPlanResponse); // Overwrite with extracted plan if found, otherwise keep raw
				iterationData.nextStepDetails = extractNextStepDetails(agentPlanResponse);

				let pythonScriptResult: any;
				let pythonScriptResultString: string | null = null; // To store the stringified result for the next prompt

				// Extract the code, compile and fix if required
				iterationData.draftCode = extractDraftPythonCode(agentPlanResponse);
				iterationData.codeReview = extractCodeReview(agentPlanResponse);
				iterationData.code = pythonMainFnCode;
				pythonMainFnCode = await ensureCorrectSyntax(pythonMainFnCode, functionsXml);
				iterationData.code = pythonMainFnCode;

				// Only keep the main-function code in the <python-code> section that we pass to the next iteration, so the agent does not see the full script.
				// Replace whatever was inside <python-code>…</python-code> with the clean main-function code we just validated.
				const sanitised = agentPlanResponse.replace(/<python-code>[\s\S]*?<\/python-code>/i, `<python-code>\n${pythonMainFnCode}\n</python-code>`);
				// Save for next prompt
				previousAgentPlanResponse = `<response>\n${sanitised}\n</response>`;

				const currentIterationFunctionCalls: FunctionCallResult[] = [];

				// Configure the objects for the Python global scope which proxy to the available @func class methods
				const functionInstances: Record<string, object> = agent.functions.getFunctionInstanceMap();
				const functionSchemas: FunctionSchema[] = getAllFunctionSchemas(Object.values(functionInstances));
				const functionProxies = setupPyodideFunctionProxies(functionSchemas, agent, agentPlanResponse, currentIterationFunctionCalls);
				const allGlobalsForPyodide = { ...functionProxies, ...pyGlobalsForNextScriptExecution }; // Combine proxies with previous script output/error global
				const pyodideGlobals = pyodide.toPy(allGlobalsForPyodide);

				const wrapperCode = generatePythonWrapper(functionSchemas, pythonMainFnCode);
				const pythonScript = wrapperCode + mainFnCodeToFullScript(pythonMainFnCode);
				iterationData.executedCode = pythonScript;

				// console.log(`\n\n\n${pythonScript}\n\n`);

				await agentStateService.updateState(agent, 'functions');

				try {
					const result = await pyodide.runPythonAsync(pythonScript, { globals: pyodideGlobals });
					// The dict_converter converts to regular JS objects instead of the default Map objects
					pythonScriptResult = result?.toJs ? result.toJs({ dict_converter: Object.fromEntries }) : result;
					if (result?.destroy) result.destroy();

					// logger.debug(`pythonScriptResult type ${typeof pythonScriptResult}`);
					if (pythonScriptResult && typeof pythonScriptResult === 'object') {
						for (const [k, v] of Object.entries(pythonScriptResult)) {
							logger.info(`${k} type ${typeof v}`);
						}
					}

					// --- Check for images and contents matching memory keys BEFORE stringifying/truncating ---
					if (typeof pythonScriptResult === 'object' && pythonScriptResult !== null) {
						// Reset images for this iteration before checking
						currentImageParts = []; // Use a temporary variable for this iteration's images
						const fileStore: FileStore | undefined = agent.functions.getFunctionType('filestore');
						currentImageParts = await checkForImageSources(pythonScriptResult, fileStore); // Pass result and filestore
						// Store the detected images for the *next* iteration's prompt
						imageParts = currentImageParts;
					} else {
						// If not an object, clear image parts for the next iteration
						imageParts = [];
					}
					pythonScriptResultString = JSON.stringify(cloneAndTruncateBuffers(pythonScriptResult));

					agent.error = undefined; // If execution succeeds reset error tracking
				} catch (e) {
					const lineNumber = extractLineNumber(e.message);
					const line = lineNumber ? ` on line "${pythonScript.split('\n')[lineNumber]}"` : '';

					// Function to remove WASM lines from the message and stack
					const removeWasmLines = (text: string) => {
						return text
							.split('\n')
							.filter((line) => !line.trim().match(/^at wasm:\/\/wasm\//))
							.join('\n');
					};
					const cleanedError = { ...e, message: removeWasmLines(e.message), stack: removeWasmLines(e.stack) };
					logger.info(cleanedError, `Caught python script error line ${line}. ${e.message}`);

					const errorString = errorToString(cleanedError);
					iterationData.error = errorString;
					agent.error = errorString;
					if (e instanceof ForceStopError) controlLoopError = e;
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
					agentRequestedFeedbackFlag = true;
				}

				// --- Handling of script output/error ---
				// The script result/error is added to the prompt for the next iteration
				// If the result/error is large then it a summary is added to the prompt for the next iteration, and the full content is available in the Python variable
				// If the result/error is small then it is added to the prompt for the next iteration, and also available in the Python variable
				const currentScriptOutputContent: string = agent.error ? agent.error : (pythonScriptResultString ?? '');
				const isError: boolean = !!agent.error;
				const pyGlobalVarName = isError ? PREVIOUS_SCRIPT_ERROR_VAR : PREVIOUS_SCRIPT_RESULT_VAR;
				const outputLengthBytes = Buffer.byteLength(currentScriptOutputContent, 'utf8');

				// Content Representation in the LLM Prompt (previousScriptResult) appended to the next iteration's prompt
				let tagAttributes = `py_var_name="${pyGlobalVarName}"`;
				if (outputLengthBytes > LARGE_OUTPUT_THRESHOLD_BYTES) {
					tagAttributes += ' summary="true"';
				}
				const promptTagContent =
					outputLengthBytes > LARGE_OUTPUT_THRESHOLD_BYTES
						? createPromptTagSummary(currentScriptOutputContent, MAX_PROMPT_TAG_CONTENT_BYTES)
						: currentScriptOutputContent;

				const tagName = isError ? 'script-error' : 'script-result';
				previousScriptResult = `<${tagName} ${tagAttributes}>${CDATA_START}\n${promptTagContent}\n${CDATA_END}</${tagName}>`;

				// Prepare Pyodide Global Variable Injection for the *next* iteration
				pyGlobalsForNextScriptExecution = { [pyGlobalVarName]: currentScriptOutputContent };
				// --- End of script output/error handling ---

				currentFunctionHistorySize = agent.functionCallHistory.length;

				currentFunctionHistorySize = agent.functionCallHistory.length;

				// Check for UI-initiated HIL request
				// If the agent hasn't already decided to stop (completed or agent-requested feedback),
				// check if the UI has requested HIL.
				if (!completed && !agentRequestedFeedbackFlag) {
					const currentAgent = await agentStateService.load(agent.agentId); // Ensure we have the latest hilRequested status
					if (currentAgent?.hilRequested) {
						agent.state = 'hitl_user';
						uiRequestedHilFlag = true;
					}
				}
			} catch (e) {
				span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
				controlLoopError = e;
				agent.state = 'error';
				agent.error = errorToString(e);
				iterationData.error = agent.error;
				logger.error(e, 'Control loop error');
			} finally {
				// Capture current memory and tool state before saving
				iterationData.memory = { ...agent.memory }; // agent.memory is Record, so spread to clone
				const toolStateMap = await buildToolStateMap(agent.functions.getFunctionInstances());
				toolStateMap[LiveFiles.name] = agent.toolState?.LiveFiles ? [...agent.toolState.LiveFiles] : [];

				if (agent.toolState?.FileSystemTree) toolStateMap.FileSystemTree = [...agent.toolState.FileSystemTree];

				// Store FileStore state
				const fileStoreTool: FileStore | null = agent.functions.getFunctionType('filestore');
				let fileStoreMetadataArray: FileMetadata[] | undefined;
				if (fileStoreTool) {
					try {
						fileStoreMetadataArray = await fileStoreTool.listFiles();
						toolStateMap[FILE_STORE_NAME] = fileStoreMetadataArray ?? [];
					} catch (e) {
						logger.error(e, 'Error listing files from FileStore before saving agent context');
					}
				}

				// Assign the consolidated map
				iterationData.toolState = toolStateMap;
				agent.toolState = toolStateMap as typeof agent.toolState;

				// Generate and set iteration summary
				await createIterationSummary(iterationData, previousScriptResult, agent);

				try {
					await agentStateService.save(agent);
				} catch (e) {
					logger.error(e, 'Error saving agent state [e]');
					controlLoopError = e;
				}

				// Save iteration data
				try {
					iterationData.cost = agent.cost - initialCost;
					await agentStateService.saveIteration(iterationData as AutonomousIteration);
				} catch (e) {
					logger.error(e, 'Error saving agent iteration data in control loop [e]');
					for (const [k, v] of Object.entries(iterationData)) {
						const bytes = Buffer.byteLength(JSON.stringify(v), 'utf8');
						if (bytes > 10000) {
							logger.info(`${k} ${bytes} bytes`);
						}
					}
				}
			}

			// Determine if the control loop should stop
			const shouldStopExecution = completed || agentRequestedFeedbackFlag || uiRequestedHilFlag || !!controlLoopError;
			return !shouldStopExecution;
		});
	}

	await runAgentCompleteHandler(agent);
	return agent.agentId;
}

/**
 * Creates a summary for the iteration.
 * @param iterationData The data for the iteration.
 * @param previousScriptResult The result of the previous script execution.
 * @param agent The agent context.
 */
async function createIterationSummary(iterationData: Partial<AutonomousIteration>, previousScriptResult: string, agent: AgentContext) {
	try {
		const planForSummary = iterationData.agentPlan || 'No plan provided.';
		const observationsForSummary = iterationData.observationsReasoning || 'No observations.';
		// previousScriptResult is already XML-tagged or contains an error message
		const scriptResultForSummary = previousScriptResult || 'No script result recorded for this iteration.';

		const summaryPromptContent = `Create a concise summary in a sentence or two for the agent's last iteration.
User Request: ${agent.userPrompt}
Agent Plan:
${planForSummary}
Observations & Reasoning:
${observationsForSummary}
Generated Code:
${iterationData.code}
Script Result/Error:
${scriptResultForSummary.length > 50000 ? scriptResultForSummary.substring(0, 50000) : scriptResultForSummary}
Focus on the outcome and next step if clear.`;

		const summaryMessage = await llms().easy.generateMessage([{ role: 'user', content: summaryPromptContent }], {
			id: 'IterationSummary',
			temperature: 0.3,
			thinking: 'low',
		});
		iterationData.summary = messageText(summaryMessage);
	} catch (e) {
		logger.error(e, 'Error creating iteration summary [e]');
		iterationData.summary = 'Failed to generate iteration summary.';
	}
}

function extractLineNumber(text: string): number | null {
	const regex = /File "<exec>", line\s+(\d+), in main/;
	const match = text.match(regex);

	if (match?.[1]) {
		return Number.parseInt(match[1], 10);
	}

	return null;
}

function setupPyodideFunctionProxies(
	functionSchemas: FunctionSchema[],
	agent: AgentContext,
	agentPlanResponse: string,
	currentIterationFunctionCalls: FunctionCallResult[],
): Record<string, (...args: any[]) => Promise<any>> {
	const functionInstances: Record<string, object> = agent.functions.getFunctionInstanceMap();
	const jsFunctionProxies: Record<string, (...args: any[]) => Promise<any>> = {};

	for (const schema of functionSchemas) {
		const [className, method] = schema.name.split(FUNC_SEP);
		if (!className || !method) throw new Error(`Invalid function schema name: ${schema.name}`);
		jsFunctionProxies[`_${schema.name}`] = async (...args: any[]) => {
			// logger.info(`args ${JSON.stringify(args)}`); // Can be very verbose
			// The system prompt instructs the generated code to use positional arguments.
			const expectedParamNames: string[] = schema.parameters.map((p) => p.name);

			const { finalArgs, parameters } = processFunctionArguments(args, expectedParamNames);

			// The `parameters` object returned from processFunctionArguments is already fully converted,
			// so the conversion block below is no longer needed and has been removed.

			try {
				const functionResponse = await functionInstances[className]![method](...finalArgs);
				// Don't need to duplicate the content in the function call history
				// TODO Would be nice to save over-written memory keys for history/debugging
				let stdout = removeConsoleEscapeChars(functionResponse);
				stdout = JSON.stringify(cloneAndTruncateBuffers(stdout));
				if (className === 'Agent' && method === 'saveMemory') parameters[AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME] = '(See <memory> entry)';
				if (className === 'Agent' && method === 'getMemory') stdout = '(See <memory> entry)';

				let stdoutSummary: string | undefined;
				if (stdout && stdout.length > FUNCTION_OUTPUT_THRESHOLD) {
					stdoutSummary = await summarizeFunctionOutput(agent, agentPlanResponse, schema, parameters, stdout);
				}

				const functionCallResult: FunctionCallResult = {
					iteration: agent.iterations,
					function_name: schema.name,
					parameters,
					stdout,
					stdoutSummary,
				};
				agent.functionCallHistory.push(functionCallResult);
				currentIterationFunctionCalls.push(functionCallResult);
				return functionResponse;
			} catch (e) {
				logger.warn(e, 'Error calling function');
				const stderr = removeConsoleEscapeChars(errorToString(e, false));
				if (stderr.length > FUNCTION_OUTPUT_THRESHOLD) {
					// For function call errors, we might not need to summarize as aggressively as script errors.
					// Keeping existing logic, or simplify if full error is always preferred for function calls.
					// stderr = await summarizeFunctionOutput(agent, agentPlanResponse, schema, parameters, stderr);
				}
				const functionCallResult: FunctionCallResult = {
					iteration: agent.iterations,
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
	return jsFunctionProxies; // Return the JS object directly
}

/**
 * Generates Python code with a helper function and minimal wrappers
 * to automatically perform a shallow conversion (.to_py(depth=1)) on JsProxy results.
 */
export function generatePythonWrapper(schemas: FunctionSchema[], generatedPythonCode: string): string {
	let helperAndWrapperCode = `
import sys
import traceback # Keep traceback for JS call errors

try:
    from pyodide.ffi import JsProxy
except ImportError:
    print("Warning: pyodide.ffi.JsProxy not found.", file=sys.stderr)
    class JsProxy: pass # Dummy class

def _try_shallow_convert_proxy(result, func_name_for_log: str):
    """
    Internal helper: Attempts shallow conversion (.to_py(depth=1)) if result is JsProxy.
    Returns converted value or original result.
    """
    if isinstance(result, JsProxy):
        try:
            # Attempt shallow conversion (converts top-level obj/arr)
            return result.to_py(depth=1)
        except Exception as e_conv:
            # If conversion fails, log warning and return original proxy
            print(f"Warning: Failed to shallow convert result of {func_name_for_log}: {e_conv}", file=sys.stderr)
            return result # Fallback to the proxy
    else:
        # If not a proxy (e.g., primitive), return directly
        return result

`;

	// --- Generate the minimal wrappers ---
	for (const schema of schemas) {
		const originalName = schema.name;
		if (!generatedPythonCode.includes(originalName)) continue;
		const internalName = `_${originalName}`;
		// Define the wrapper function with the original name
		helperAndWrapperCode += `
async def ${originalName}(*args, **kwargs):
    try:
        raw_result = await ${internalName}(*args, **kwargs)
        return _try_shallow_convert_proxy(raw_result, '${originalName}')
    except Exception as e_call:
        print(f"Error during call to underlying JS function '${internalName}': {e_call}", file=sys.stderr)
        # Optionally print traceback for detailed debugging
        traceback.print_exc(file=sys.stderr)
        raise

`;
	}
	return helperAndWrapperCode;
}

async function initPyodide(): Promise<PyodideInterface> {
	pyodide = await loadPyodide();
	pyodide.setDebug(true); // This can be very verbose, enable if needed for Pyodide internal debugging

	pyodide.setStdout({
		batched: (outputLine: string) => {
			const currentAgent = agentContext();
			if (!currentAgent || !currentAgent.agentId) {
				logger.warn({ log: outputLine }, 'CodeGen stdout (no agent context)');
				return;
			}
			const agentId = currentAgent.agentId;

			let agentBufferEntry = agentStdoutBuffers.get(agentId);
			if (!agentBufferEntry) {
				agentBufferEntry = { buffer: [], timer: null };
				agentStdoutBuffers.set(agentId, agentBufferEntry);
			}

			agentBufferEntry.buffer.push(outputLine);

			if (agentBufferEntry.timer) clearTimeout(agentBufferEntry.timer);

			agentBufferEntry.timer = setTimeout(() => {
				// Fetch the entry again to ensure it hasn't been cleared by cleanup
				const entryToLog = agentStdoutBuffers.get(agentId);
				if (entryToLog && entryToLog.buffer.length > 0) {
					const collectedOutput = entryToLog.buffer.join(''); // Concatenate lines
					logger.info({ agentId, log: collectedOutput }, 'CodeGen stdout');
					entryToLog.buffer = []; // Clear buffer for this agent
				}
				if (entryToLog) entryToLog.timer = null; // Mark timer as inactive
			}, PYODIDE_LOG_DEBOUNCE_MS);
		},
	});

	pyodide.setStderr({
		batched: (outputLine: string) => {
			const currentAgent = agentContext();
			if (!currentAgent || !currentAgent.agentId) {
				logger.warn({ log: outputLine }, 'CodeGen stderr (no agent context)');
				return;
			}
			const agentId = currentAgent.agentId;

			let agentBufferEntry = agentStderrBuffers.get(agentId);
			if (!agentBufferEntry) {
				agentBufferEntry = { buffer: [], timer: null };
				agentStderrBuffers.set(agentId, agentBufferEntry);
			}

			agentBufferEntry.buffer.push(outputLine);

			if (agentBufferEntry.timer) clearTimeout(agentBufferEntry.timer);

			agentBufferEntry.timer = setTimeout(() => {
				// Fetch the entry again to ensure it hasn't been cleared by cleanup
				const entryToLog = agentStderrBuffers.get(agentId);
				if (entryToLog && entryToLog.buffer.length > 0) {
					const collectedOutput = entryToLog.buffer.join(''); // Concatenate lines
					logger.info({ agentId, log: collectedOutput }, 'CodeGen stderr');
					entryToLog.buffer = []; // Clear buffer for this agent
				}
				if (entryToLog) entryToLog.timer = null; // Mark timer as inactive
			}, PYODIDE_LOG_DEBOUNCE_MS);
		},
	});

	return pyodide;
}

function cleanupAgentPyodideLogs(agentId: string) {
	const stdoutEntry = agentStdoutBuffers.get(agentId);
	if (stdoutEntry?.timer) {
		clearTimeout(stdoutEntry.timer);
	}
	agentStdoutBuffers.delete(agentId);

	const stderrEntry = agentStderrBuffers.get(agentId);
	if (stderrEntry?.timer) {
		clearTimeout(stderrEntry.timer);
	}
	agentStderrBuffers.delete(agentId);
	logger.debug(`Cleaned up Pyodide log buffers for agent [${agentId}]`);
}

async function ensureCorrectSyntax(pythonMainFnCode: string, functionsXml: string): Promise<string> {
	const MAX_ATTEMPTS = 5;
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

function createPromptTagSummary(content: string, maxLength: number): string {
	if (Buffer.byteLength(content, 'utf8') <= maxLength) {
		return content;
	}
	// Simple truncation for summary: half from start, half from end
	const halfMaxLength = Math.floor(maxLength / 2) - 20; // -20 for "...\n...\n..."
	if (halfMaxLength <= 0) return content.substring(0, maxLength); // Fallback for very small maxLength

	let startStr = '';
	let endStr = '';
	let currentLength = 0;
	for (let i = 0; i < content.length; i++) {
		const char = content[i]!;
		const charLen = Buffer.byteLength(char, 'utf8');
		if (currentLength + charLen > halfMaxLength) break;
		startStr += char;
		currentLength += charLen;
	}

	currentLength = 0;
	for (let i = content.length - 1; i >= 0; i--) {
		const char = content[i]!;
		const charLen = Buffer.byteLength(char, 'utf8');
		if (currentLength + charLen > halfMaxLength) break;
		endStr = char + endStr;
		currentLength += charLen;
	}
	return `${startStr}\n...\n[Content Truncated]\n...\n${endStr}`;
}
