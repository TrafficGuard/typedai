import { readFileSync } from 'fs';
import { Span, SpanStatusCode } from '@opentelemetry/api';
import { runAgentCompleteHandler } from '#agent/agentCompletion';
import { AgentContext } from '#agent/agentContextTypes';
import { AGENT_REQUEST_FEEDBACK } from '#agent/agentFeedback';
import { AGENT_COMPLETED_NAME } from '#agent/agentFunctions';
import { buildFunctionCallHistoryPrompt, buildMemoryPrompt, buildToolStatePrompt, updateFunctionSchemas } from '#agent/agentPromptUtils';
import { AgentExecution, formatFunctionError, formatFunctionResult, summariseLongFunctionOutput } from '#agent/agentRunner';
import { getServiceName } from '#fastify/trace-init/trace-init';
import { FunctionSchema, getAllFunctionSchemas } from '#functionSchema/functions';
import { FunctionResponse } from '#llm/llm';
import { parseFunctionCallsXml } from '#llm/responseParsers';
import { logger } from '#o11y/logger';
import { withActiveSpan } from '#o11y/trace';
import { errorToString } from '#utils/errors';
import { appContext } from '../applicationContext';
import { agentContextStorage, llms } from './agentContextLocalStorage';
import { HitlCounters, checkHumanInTheLoop } from './humanInTheLoopChecks';

export const XML_AGENT_SPAN = 'XmlAgent';

const stopSequences = ['</response>'];

export async function runXmlAgent(agent: AgentContext): Promise<AgentExecution> {
	// Hot reload (TODO only when not deployed)
	const xmlSystemPrompt = readFileSync('src/agent/xml-agent-system-prompt').toString();

	const agentStateService = appContext().agentStateService;
	agent.state = 'agent';

	agentContextStorage.enterWith(agent);

	const agentLLM = llms().hard;

	const userRequestXml = `<user_request>\n${agent.userPrompt}\n</user_request>\n`;
	let currentPrompt = agent.inputPrompt;

	const agentFunctions = agent.functions;

	const functionsXml = convertJsonToXml(getAllFunctionSchemas(agentFunctions.getFunctionInstances()));
	const systemPromptWithFunctions = updateFunctionSchemas(xmlSystemPrompt, functionsXml);

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
	/** How many function calls have returned an error since the last human-in-the-loop check */
	let functionErrorCount = 0;

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

		let shouldContinue = true;
		while (shouldContinue) {
			shouldContinue = await withActiveSpan(XML_AGENT_SPAN, async (span) => {
				agent.callStack = [];
				let completed = false;
				let requestFeedback = false;
				let anyFunctionCallErrors = false;
				let controlError = false;
				try {
					hitlCounters = await checkHumanInTheLoop(hitlCounters, agent, agentStateService);

					const filePrompt = await buildToolStatePrompt();

					if (!currentPrompt.includes('<function_call_history>')) {
						currentPrompt = buildFunctionCallHistoryPrompt('history') + buildMemoryPrompt() + filePrompt + currentPrompt;
					}

					if (agent.error) {
						currentPrompt +=
							'\nThe last function call returned an error. Re-asses whether to 1) Retry a transient error. 2) Update the plan to work around it. 3) Request feedback if it doesnt seem fixable.';
					}

					let functionResponse: FunctionResponse;
					let llmResponse: string;
					try {
						llmResponse = await agentLLM.generateText(systemPromptWithFunctions, currentPrompt, {
							id: 'generateFunctionCalls',
							stopSequences,
						});
						functionResponse = {
							textResponse: llmResponse,
							functions: parseFunctionCallsXml(llmResponse),
						};
					} catch (e) {
						// Should just catch parse error
						const retryPrompt = `${currentPrompt}\nNote: Your previous response did not contain the response in the required format of <response><function_calls>...</function_calls></response>. You must reply in the correct response format.`;
						llmResponse = await agentLLM.generateText(systemPromptWithFunctions, retryPrompt, {
							id: 'generateFunctionCalls-retryError',
							stopSequences,
						});
						functionResponse = {
							textResponse: llmResponse,
							functions: parseFunctionCallsXml(llmResponse),
						};
					}
					currentPrompt = buildFunctionCallHistoryPrompt('history') + buildMemoryPrompt() + filePrompt + userRequestXml + functionResponse.textResponse;
					const functionCalls = functionResponse.functions.functionCalls;

					if (!functionCalls.length) {
						// Re-try once with an addition to the prompt that there was no function calls,
						// and it should call one of the Agent functions to finish if it's not sure what to do next.
						const retryPrompt = `${currentPrompt}
						Note: Your previous response did not contain a function call.  If you are able to answer/complete the question/task, then call the ${AGENT_COMPLETED_NAME} function with the appropriate response.
						If you are unsure what to do next then call the ${AGENT_REQUEST_FEEDBACK} function with a clarifying question.`;

						llmResponse = await agentLLM.generateText(systemPromptWithFunctions, retryPrompt, {
							id: 'generateFunctionCalls-retryNoFunctions',
							stopSequences,
						});
						const functionCallResponse: FunctionResponse = {
							textResponse: llmResponse,
							functions: parseFunctionCallsXml(llmResponse),
						};
						// retrying
						currentPrompt = buildFunctionCallHistoryPrompt('history') + buildMemoryPrompt() + filePrompt + userRequestXml + functionCallResponse.textResponse;
						const functionCalls = functionCallResponse.functions.functionCalls;
						if (!functionCalls.length) {
							throw new Error('Found no function invocations');
						}
					}

					agent.state = 'functions';
					agent.inputPrompt = currentPrompt;
					agent.invoking.push(...functionCalls);
					await agentStateService.save(agent);

					// The XML formatted results of the function call(s)
					const functionResults: string[] = [];

					for (const functionCall of functionCalls) {
						try {
							const functionResponse: any = await agentFunctions.callFunction(functionCall);
							const functionResult = formatFunctionResult(functionCall.function_name, functionResponse);
							// if (functionResult.startsWith('<response>')) functionResult = functionResult.slice(10); // do we need this here? seem more for the agent control loop response
							// The trailing </response> will be removed as it's a stop word for the LLMs
							functionResults.push(formatFunctionResult(functionCall.function_name, functionResponse));
							const functionResponseString = JSON.stringify(functionResponse ?? '');

							// To minimise the function call history size becoming too large (i.e. expensive & slow) we'll create a summary for responses which are quite long
							const outputSummary: string | null = await summariseLongFunctionOutput(functionCall, functionResponse);

							agent.functionCallHistory.push({
								function_name: functionCall.function_name,
								parameters: functionCall.parameters,
								stdout: JSON.stringify(functionResponse),
								stdoutSummary: outputSummary,
							});
							// Should check if completed or requestFeedback then there's no more function calls
							if (functionCall.function_name === AGENT_COMPLETED_NAME) {
								logger.info('Task completed');
								agent.state = 'completed';
								completed = true;
								break;
							}
							if (functionCall.function_name === AGENT_REQUEST_FEEDBACK) {
								logger.info('Feedback requested');
								agent.state = 'feedback';
								requestFeedback = true;
								break;
							}
							agent.error = null;
						} catch (e) {
							functionErrorCount++;
							anyFunctionCallErrors = true;
							agent.state = 'error';
							logger.error(e, 'Function error');
							agent.error = errorToString(e);
							await agentStateService.save(agent);
							functionResults.push(formatFunctionError(functionCall.function_name, e));
							// currentPrompt += `\n${llm.formatFunctionError(functionCalls.function_name, e)}`;

							agent.functionCallHistory.push({
								function_name: functionCall.function_name,
								parameters: functionCall.parameters,
								stderr: agent.error,
							});
							// How to handle function call errors? Give the agent a chance to re-try or try something different, or always human in loop?
						}
					}
					// Function invocations are complete
					span.setAttribute('functionCalls', functionCalls.map((functionCall) => functionCall.function_name).join(', '));

					// This section is duplicated in the provideFeedback function
					agent.invoking = [];
					// TODO allow a configurable number of errors before human-in-the-loop required
					if (!anyFunctionCallErrors && !completed && !requestFeedback) agent.state = 'agent';
					currentPrompt = `${userRequestXml}\n${functionResponse.textResponse}\n${functionResults.join('\n')}`;
				} catch (e) {
					span.setStatus({ code: SpanStatusCode.ERROR, message: e.toString() });
					logger.error(e, 'Control loop error');
					controlError = true;
					agent.state = 'error';
					agent.error = errorToString(e);
				} finally {
					agent.inputPrompt = currentPrompt;
					agent.callStack = [];
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

/**
 * Converts the JSON function schemas to the XML format described in the xml-agent-system-prompt
 * @param jsonDefinitions The JSON object containing function schemas
 * @returns A string containing the XML representation of the function schemas
 */
function convertJsonToXml(jsonDefinitions: FunctionSchema[]): string {
	let xmlOutput = '<functions>\n';

	for (const funcDef of jsonDefinitions) {
		xmlOutput += '  <function_description>\n';
		xmlOutput += `    <function_name>${funcDef.name}</function_name>\n`;
		xmlOutput += `    <description>${funcDef.description}</description>\n`;

		if (funcDef.parameters.length > 0) {
			xmlOutput += '    <parameters>\n';
			for (const param of funcDef.parameters) {
				xmlOutput += `    <${param.name} type="${param.type}" ${param.optional ? 'optional' : ''}>${param.description}</${param.name}>\n`;
				// xmlOutput += '      <parameter>\n';
				// xmlOutput += `        <name>${param.name}</name>\n`;
				// xmlOutput += `        <type>${param.type}</type>\n`;
				// if (param.optional) {
				// 	xmlOutput += '        <optional>true</optional>\n';
				// }
				// xmlOutput += `        <description>${param.description}</description>\n`;
				// xmlOutput += '      </parameter>\n';
			}
			xmlOutput += '    </parameters>\n';
		}

		if (funcDef.returns) {
			xmlOutput += `    <returns>${funcDef.returns}</returns>\n`;
		}

		xmlOutput += '  </function_description>\n';
	}

	xmlOutput += '</functions>';
	return xmlOutput;
}
