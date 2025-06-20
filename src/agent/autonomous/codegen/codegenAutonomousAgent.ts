import { readFileSync } from 'node:fs';
import { type Span, SpanStatusCode } from '@opentelemetry/api';
import { type PyodideInterface, loadPyodide } from 'pyodide';
import { buildMemoryPrompt, buildToolStateMap, buildToolStatePrompt, updateFunctionSchemas } from '#agent/agentPromptUtils';
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
import { FUNC_SEP, type FunctionParameter, type FunctionSchema, getAllFunctionSchemas } from '#functionSchema/functions';
import type { FileStore } from '#functions/storage/filestore';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import type { AgentContext, AutonomousIteration } from '#shared/agent/agent.model';
import { FILE_STORE_NAME, type FileMetadata } from '#shared/files/files.model';
import { type FunctionCallResult, type ImagePartExt, type LlmMessage, type UserContentExt, messageText, system, text, user } from '#shared/llm/llm.model';
import { errorToString } from '#utils/errors';
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

const stopSequences = ['</response>'];

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
					agentPlanResponseMessage = await agent.llms.hard.generateMessage(agentMessages, {
						id: 'Codegen agent plan',
						stopSequences,
						temperature: 0.2,
						thinking: 'high',
						maxOutputTokens: 32000,
					});
					agentPlanResponse = messageText(agentPlanResponseMessage);
					pythonMainFnCode = extractPythonCode(agentPlanResponse);
				} catch (e) {
					logger.warn(e, 'Error with Codegen agent plan');
					agentPlanResponseMessage = await agent.llms.hard.generateMessage(agentMessages, {
						id: 'Codegen agent plan retry',
						stopSequences,
						temperature: 0.2,
						thinking: 'high',
						maxOutputTokens: 32000,
					});
					agentPlanResponse = messageText(agentPlanResponseMessage);
					pythonMainFnCode = extractPythonCode(agentPlanResponse);
				}
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
				iterationData.draftCode = extractDraftPythonCode(agentPlanResponse);
				iterationData.codeReview = extractCodeReview(agentPlanResponse);
				iterationData.code = pythonMainFnCode;
				pythonMainFnCode = await ensureCorrectSyntax(pythonMainFnCode, functionsXml);
				iterationData.code = pythonMainFnCode;

				const currentIterationFunctionCalls: FunctionCallResult[] = [];
				// Configure the objects for the Python global scope which proxy to the available @func class methods
				const functionInstances: Record<string, object> = agent.functions.getFunctionInstanceMap();
				const functionSchemas: FunctionSchema[] = getAllFunctionSchemas(Object.values(functionInstances));
				const globals = setupPyodideFunctionCallableGlobals(functionSchemas, agent, agentPlanResponse, currentIterationFunctionCalls);
				const wrapperCode = generatePythonWrapper(functionSchemas, pythonMainFnCode);

				const pythonScript = wrapperCode + mainFnCodeToFullScript(pythonMainFnCode);
				iterationData.executedCode = pythonScript;

				// console.log(`\n\n\n${pythonScript}\n\n`);

				await agentStateService.updateState(agent, 'functions');

				try {
					const result = await pyodide.runPythonAsync(pythonScript, { globals });
					// The dict_converter converts to regular JS objects instead of the default Map objects
					pythonScriptResult = result?.toJs ? result.toJs({ dict_converter: Object.fromEntries }) : result;
					if (result?.destroy) result.destroy();

					logger.info(`pythonScriptResult type ${typeof pythonScriptResult}`);
					if (pythonScriptResult && typeof pythonScriptResult === 'object') {
						for (const [k, v] of Object.entries(pythonScriptResult)) {
							logger.info(`${k} type ${typeof v}`);
						}
					}

					// --- Check for images and contents matching memory keys BEFORE stringifying/truncating ---
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
					pythonScriptResultString = JSON.stringify(cloneAndTruncateBuffers(pythonScriptResult));

					agent.error = null; // If execution succeeds reset error tracking
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
					requestFeedback = true;
				}

				// Store the script result string (or error) for the next iteration's prompt
				previousScriptResult = agent.error
					? `<python-script>\n${pythonMainFnCode}\n</python-script>\n<script-error>\n${agent.error}\n</script-error>`
					: `<script-result>${pythonScriptResultString}</script-result>`;

				currentFunctionHistorySize = agent.functionCallHistory.length;

				// If the agent hasn't already transitioned to completed or hitl_feedback then
				// update the state to hitl_feedback if requested
				const currentAgent = await agentStateService.load(agent.agentId);
				if (currentAgent.hilRequested) {
					if (agent.state === 'functions') {
						agent.state = 'hitl_feedback';
						requestFeedback = true;
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
				toolStateMap[LiveFiles.name] = agent.toolState.LiveFiles ? [...agent.toolState.LiveFiles] : [];

				if (agent.toolState.FileSystemTree) toolStateMap.FileSystemTree = [...agent.toolState.FileSystemTree];

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
				try {
					// Ensure required fields for summary are available
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

function setupPyodideFunctionCallableGlobals(
	functionSchemas: FunctionSchema[],
	agent: AgentContext,
	agentPlanResponse: string,
	currentIterationFunctionCalls: FunctionCallResult[],
) {
	const functionInstances: Record<string, object> = agent.functions.getFunctionInstanceMap();

	const jsGlobals = {};
	for (const schema of functionSchemas) {
		const [className, method] = schema.name.split(FUNC_SEP);
		jsGlobals[`_${schema.name}`] = async (...args: any[]) => {
			// logger.info(`args ${JSON.stringify(args)}`); // Can be very verbose
			// The system prompt instructs the generated code to use positional arguments.
			const expectedParamNames: string[] = schema.parameters.map((p) => p.name);

			const { finalArgs, parameters } = processFunctionArguments(args, expectedParamNames);

			try {
				const functionResponse = await functionInstances[className][method](...finalArgs);
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
				let stderr = removeConsoleEscapeChars(errorToString(e, false));
				if (stderr.length > FUNCTION_OUTPUT_THRESHOLD) {
					stderr = await summarizeFunctionOutput(agent, agentPlanResponse, schema, parameters, stderr);
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
	return pyodide.toPy(jsGlobals);
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
	// pyodide.setDebug(true); // This can be very verbose, enable if needed for Pyodide internal debugging

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
