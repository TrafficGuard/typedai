import { readFileSync } from 'fs';
import { Span, SpanStatusCode } from '@opentelemetry/api';
import { PyodideInterface, loadPyodide } from 'pyodide';
import { runAgentCompleteHandler } from '#agent/agentCompletion';
import { AgentContext } from '#agent/agentContextTypes';
import { AGENT_REQUEST_FEEDBACK } from '#agent/agentFeedback';
import { AGENT_COMPLETED_NAME, AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME } from '#agent/agentFunctions';
import { buildFunctionCallHistoryPrompt, buildMemoryPrompt, buildToolStatePrompt, updateFunctionSchemas } from '#agent/agentPromptUtils';
import { AgentExecution, formatFunctionError, formatFunctionResult } from '#agent/agentRunner';
import { convertJsonToPythonDeclaration, extractPythonCode } from '#agent/codeGenAgentUtils';
import { humanInTheLoop, notifySupervisor } from '#agent/humanInTheLoop';
import { getServiceName } from '#fastify/trace-init/trace-init';
import { FUNC_SEP, FunctionSchema, getAllFunctionSchemas } from '#functionSchema/functions';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { errorToString } from '#utils/errors';
import { appContext } from '../applicationContext';
import { agentContextStorage, llms } from './agentContextLocalStorage';

const stopSequences = ['</response>'];

export const CODEGEN_AGENT_SPAN = 'Codegen Agent';

let pyodide: PyodideInterface;

/*
 * The aim of the cachingCodegen agent compared to the codegenAgent is to utilise context caching in Claude/OpenAI/DeepSeek.
 * This will require using the new methods on the LLM interface which have a message history. This message history
 * will be treated in some ways like a stack.
 *
 * Message stack:
 * system prompt
 * function definitions
 * user request
 * -- cache
 * memory
 * -- cache
 * user - function call history
 * assistant - response
 * -----------------------
 * user - function call results
 * assistant - observations/actions/memory ops
 *
 */
/**
 *
 * @param agent
 */
export async function runCachingCodegenAgent(agent: AgentContext): Promise<AgentExecution> {
	if (!pyodide) pyodide = await loadPyodide();

	// Hot reload (TODO only when not deployed)
	const systemPrompt = readFileSync('src/agent/caching-codegen-agent-system-prompt').toString();
	const planningPrompt = readFileSync('src/agent/caching-planning').toString();
	const codingPrompt = readFileSync('src/agent/coding-planning').toString();

	const agentStateService = appContext().agentStateService;
	agent.state = 'agent';

	agentContextStorage.enterWith(agent);

	const agentLLM = llms().hard;

	const userRequestXml = `<user_request>\n${agent.userPrompt}\n</user_request>`;
	const currentPrompt = agent.inputPrompt;
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

	let countSinceHil = 0;

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

		let functionErrorCount = 0;

		let currentFunctionHistorySize = agent.functionCallHistory.length;

		let shouldContinue = true;
		while (shouldContinue) {
			shouldContinue = await withActiveSpan(CODEGEN_AGENT_SPAN, async (span) => {
				agent.callStack = [];

				let completed = false;
				let requestFeedback = false;
				const anyFunctionCallErrors = false;
				let controlError = false;
				try {
					// Human in the loop checks ------------------------
					if (hilCount && countSinceHil === hilCount) {
						await humanInTheLoop(`Agent control loop has performed ${hilCount} iterations`);
						countSinceHil = 0;
					}
					countSinceHil++;

					logger.debug(`Budget remaining $${agent.budgetRemaining.toFixed(2)}. Total cost $${agentContextStorage.getStore().cost.toFixed(2)}`);
					if (hilBudget && agent.budgetRemaining <= 0) {
						// HITL happens once budget is exceeded, which may be more than the allocated budget
						const increase = agent.hilBudget - agent.budgetRemaining;
						await humanInTheLoop(`Agent cost has increased by USD\$${increase.toFixed(2)}. Increase budget by $${agent.hilBudget}`);
						agent.budgetRemaining = agent.hilBudget;
					}

					// Main control loop action ------------------------

					// Agent state ----------------

					// Function definitions. May need to reload the agent for dynamic updating of the tools
					const functionsXml = convertJsonToPythonDeclaration(getAllFunctionSchemas(agent.functions.getFunctionInstances()));
					const systemPromptWithFunctions = updateFunctionSchemas(systemPrompt, functionsXml);

					agent.messages[0] = { role: 'system', content: systemPromptWithFunctions, cache: 'ephemeral' };

					// User request. The functions and user request are unlikely to change, so we will use a cache marker
					agent.messages[1] = { role: 'user', content: userRequestXml, cache: 'ephemeral' };

					// Memory output
					agent.messages[2] = { role: 'assistant', content: `This is my current memory items:\n${buildMemoryPrompt()}`, cache: 'ephemeral' };

					// Function history and tool state
					const toolStatePrompt = await buildToolStatePrompt();
					// If the last function was requestFeedback then we'll remove it from function history add it as function results
					let historyToIndex = agent.functionCallHistory.length ? agent.functionCallHistory.length - 1 : 0;
					let requestFeedbackCallResult = '';
					if (agent.functionCallHistory.length && agent.functionCallHistory.at(-1).function_name === AGENT_REQUEST_FEEDBACK) {
						historyToIndex--;
						requestFeedbackCallResult = buildFunctionCallHistoryPrompt('results', 10000, historyToIndex + 1, historyToIndex + 2);
					}
					const oldFunctionCallHistory = buildFunctionCallHistoryPrompt('history', 10000, 0, historyToIndex);

					agent.messages[3] = { role: 'user', content: `State your recent function call history${toolStatePrompt ? ' and functions/tool state.' : ''}` };
					agent.messages[4] = { role: 'assistant', content: `${oldFunctionCallHistory}\n${toolStatePrompt}` };

					const isNewAgent = agent.iterations === 0 && agent.functionCallHistory.length === 0;
					// // For the initial prompt we create the empty memory, functional calls and default tool state content. Subsequent iterations already have it
					// const initialPrompt = isNewAgent
					// 	? oldFunctionCallHistory + buildMemoryPrompt() + toolStatePrompt + currentPrompt
					// 	: currentPrompt + requestFeedbackCallResult;

					// Planning ----------------

					agent.messages[5] = {
						role: 'user',
						content: planningPrompt, // 'Generate a <planning-response> response as per the system instructions provided given the user request, available functions, memory items and recent function call history'
					};
					agent.messages[6] = { role: 'assistant', content: '<planning-response>' };
					agent.messages.length = 7; // If we've restarted remove any extra messages
					const agentPlanResponse: string = `<planning-response>\n${await agentLLM.generateText(agent.messages, {
						id: 'dynamicAgentPlan',
						stopSequences,
						temperature: 0.6,
					})}`;
					agent.messages[6] = { role: 'assistant', content: agentPlanResponse };

					// Code gen for function calling -----------

					agent.messages[7] = {
						role: 'user',
						content: codingPrompt, // 'Generate a coding response as per the system instructions provided given the user request, memory items, recent function call history and plan'
					};
					agent.messages[8] = { role: 'assistant', content: '<python-code>' };
					const agentCodeResponse: string = `<python-code>\n${await agentLLM.generateText(agent.messages, {
						id: 'dynamicAgentCode',
						stopSequences,
						temperature: 0.7,
					})}`;
					console.log(agentCodeResponse);
					agent.messages[8] = { role: 'assistant', content: agentCodeResponse };
					const llmPythonCode = extractPythonCode(agentCodeResponse);

					// Function calling ----------------

					agent.state = 'functions';
					await agentStateService.save(agent);

					// The XML formatted results of the function call(s)
					const functionResults: string[] = [];
					let pythonScriptResult: any;
					let pythonScript = '';

					const functionInstances: Record<string, object> = agent.functions.getFunctionInstanceMap();
					const schemas: FunctionSchema[] = getAllFunctionSchemas(Object.values(functionInstances));
					const jsGlobals = {};
					for (const schema of schemas) {
						const [className, method] = schema.name.split(FUNC_SEP);
						jsGlobals[schema.name] = async (...args) => {
							// Convert arg array to parameters name/value map
							const parameters: { [key: string]: any } = {};
							for (let index = 0; index < args.length; index++) parameters[schema.parameters[index].name] = args[index];

							try {
								const functionResponse = await functionInstances[className][method](...args);
								// To minimise the function call history size becoming too large (i.e. expensive)
								// we'll create a summary for responses which are quite long
								// const outputSummary = await summariseLongFunctionOutput(functionResponse)

								// Don't need to duplicate the content in the function call history
								// TODO Would be nice to save over-written memory keys for history/debugging
								let stdout = JSON.stringify(functionResponse);
								if (className === 'Agent' && method === 'saveMemory') parameters[AGENT_SAVE_MEMORY_CONTENT_PARAM_NAME] = '(See <memory> entry)';
								if (className === 'Agent' && method === 'getMemory') stdout = '(See <memory> entry)';

								agent.functionCallHistory.push({
									function_name: schema.name,
									parameters,
									stdout,
									// stdoutSummary: outputSummary, TODO
								});
								functionResults.push(formatFunctionResult(schema.name, functionResponse));
								return functionResponse;
							} catch (e) {
								functionResults.push(formatFunctionError(schema.name, e));

								agent.functionCallHistory.push({
									function_name: schema.name,
									parameters,
									stderr: errorToString(e, false),
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
					const allowedImports = ['json', 're', 'math', 'datetime'];
					// Add the imports from the allowed packages being used in the script
					pythonScript = allowedImports
						.filter((pkg) => llmPythonCode.includes(`${pkg}.`) || pkg === 'json') // always need json for JsProxyEncoder
						.map((pkg) => `import ${pkg}\n`)
						.join();

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
							if (e.type !== 'IndentationError' && e.type !== 'SyntaxError') throw e;

							// Fix the compile issues in the script
							const prompt = `${functionsXml}\n<python>\n${pythonScript}</python>\n<error>${e.message}</error>\nPlease adjust/reformat the Python script to fix the issue. Output only the updated code. Do no chat, do not output markdown ticks. Only the updated code.`;
							pythonScript = await llms().hard.generateText(prompt, { id: 'Fix python script error' });

							// Re-try execution of fixed syntax/indentation error
							const result = await pyodide.runPythonAsync(pythonScript, { globals });
							pythonScriptResult = result?.toJs ? result.toJs() : result;
							pythonScriptResult = JSON.stringify(pythonScriptResult);
							if (result?.destroy) result.destroy();
						}
						logger.info(pythonScriptResult, 'Script result');

						const lastFunctionCall = agent.functionCallHistory[agent.functionCallHistory.length - 1];

						// Should force completed/requestFeedback to exit the script - throw a particular Error class
						if (lastFunctionCall.function_name === AGENT_COMPLETED_NAME) {
							logger.info('Task completed');
							agent.state = 'completed';
							completed = true;
						} else if (lastFunctionCall.function_name === AGENT_REQUEST_FEEDBACK) {
							logger.info('Feedback requested');
							agent.state = 'feedback';
							requestFeedback = true;
						} else {
							if (!anyFunctionCallErrors && !completed && !requestFeedback) agent.state = 'agent';
						}
					} catch (e) {
						logger.info(`Caught function error ${e.message}`);
						functionErrorCount++;
					}
					// Function invocations are complete

					const currentFunctionCallHistory = buildFunctionCallHistoryPrompt('results', 10000, currentFunctionHistorySize);
					// TODO output any saved memory items
					agent.messages[9] = {
						role: 'user',
						content: `<script-result>${pythonScriptResult}</script-result>\nReview the results of the scripts and make any observations about the output/errors, then provide an updated planning response.`,
					};

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
