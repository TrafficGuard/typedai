import { LlmFunctions } from '#agent/LlmFunctions';
import { createContext, llms } from '#agent/agentContextLocalStorage';
import { AgentCompleted, AgentContext, AgentLLMs, AgentType } from '#agent/agentContextTypes';
import { AGENT_REQUEST_FEEDBACK } from '#agent/agentFeedback';
import { AGENT_COMPLETED_PARAM_NAME } from '#agent/agentFunctions';
import { runCodeGenAgent } from '#agent/codeGenAgentRunner';
import { runXmlAgent } from '#agent/xmlAgentRunner';
import { FUNC_SEP } from '#functionSchema/functions';
import { FunctionCall, FunctionCallResult } from '#llm/llm';
import { logger } from '#o11y/logger';
import { User } from '#user/user';
import { errorToString } from '#utils/errors';
import { CDATA_END, CDATA_START } from '#utils/xml-utils';
import { appContext } from '../applicationContext';

export const SUPERVISOR_RESUMED_FUNCTION_NAME: string = `Supervisor${FUNC_SEP}Resumed`;
export const SUPERVISOR_CANCELLED_FUNCTION_NAME: string = `Supervisor${FUNC_SEP}Cancelled`;
const FUNCTION_OUTPUT_SUMMARIZE_MIN_LENGTH = 2000;

export type RunWorkflowConfig = Partial<RunAgentConfig>;

/**
 * Configuration for running an autonomous agent
 */
export interface RunAgentConfig {
	/** The user who created the agent. Uses currentUser() if not provided */
	user?: User;
	/** The parent agentId */
	parentAgentId?: string;
	/** The name of this agent */
	agentName: string;
	/** The type of autonomous agent function calling. Defaults to codegen */
	type?: AgentType;
	/** The function classes the agent has available to call */
	functions: LlmFunctions | Array<new () => any>;
	/** Handler for when the agent finishes executing. Defaults to console output */
	completedHandler?: AgentCompleted;
	/** The user prompt */
	initialPrompt: string;
	/** The agent system prompt */
	systemPrompt?: string;
	/** Settings for requiring a human-in-the-loop */
	humanInLoop?: { budget?: number; count?: number; functionErrorCount?: number };
	/** The default LLMs available to use */
	llms?: AgentLLMs;
	/** The agent to resume */
	resumeAgentId?: string;
	/** The base path of the context FileSystem. Defaults to the process working directory */
	fileSystemPath?: string;
	/** Additional details for the agent */
	metadata?: Record<string, any>;
}

/**
 * The reference to a running agent
 */
export interface AgentExecution {
	agentId: string;
	execution: Promise<any>;
}

/**
 * The active running agents
 */
export const agentExecutions: Record<string, AgentExecution> = {};

async function runAgent(agent: AgentContext): Promise<AgentExecution> {
	let execution: AgentExecution;
	switch (agent.type) {
		case 'xml':
			execution = await runXmlAgent(agent);
			break;
		case 'codegen':
			execution = await runCodeGenAgent(agent);
			break;
		default:
			throw new Error(`Invalid agent type ${agent.type}`);
	}

	agentExecutions[agent.agentId] = execution;
	execution.execution.finally(() => {
		delete agentExecutions[agent.agentId];
	});
	return execution;
}

export async function startAgentAndWaitForCompletion(config: RunAgentConfig): Promise<string> {
	const agentExecution = await startAgent(config);
	await agentExecution.execution;
	const agent = await appContext().agentStateService.load(agentExecution.agentId);
	if (agent.state !== 'completed') throw new Error(`Agent has completed executing in state "${agent.state}"`);
	return agent.functionCallHistory.at(-1).parameters[AGENT_COMPLETED_PARAM_NAME];
}

export async function startAgentAndWait(config: RunAgentConfig): Promise<string> {
	const agentExecution = await startAgent(config);
	await agentExecution.execution;
	return agentExecution.agentId;
}

export async function startAgent(config: RunAgentConfig): Promise<AgentExecution> {
	const agent: AgentContext = createContext(config);

	if (config.initialPrompt?.includes('<user_request>')) {
		const startIndex = config.initialPrompt.indexOf('<user_request>') + '<user_request>'.length;
		const endIndex = config.initialPrompt.indexOf('</user_request>');
		agent.inputPrompt = config.initialPrompt;
		agent.userPrompt = config.initialPrompt.slice(startIndex, endIndex);
		logger.info('Extracted <user_request>');
		logger.info(`agent.userPrompt: ${agent.userPrompt}`);
		logger.info(`agent.inputPrompt: ${agent.inputPrompt}`);
	} else {
		agent.userPrompt = config.initialPrompt;
		agent.inputPrompt = `<user_request>${config.initialPrompt}</user_request>`;
		logger.info('Wrapping initialPrompt in <user_request>');
		logger.info(`agent.userPrompt: ${agent.userPrompt}`);
		logger.info(`agent.inputPrompt: ${agent.inputPrompt}`);
	}
	await appContext().agentStateService.save(agent);
	logger.info(`Created agent ${agent.agentId}`);

	return runAgent(agent);
}

export async function cancelAgent(agentId: string, executionId: string, feedback: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been cancelled/resumed');

	agent.functionCallHistory.push({
		function_name: SUPERVISOR_CANCELLED_FUNCTION_NAME,
		stdout: feedback,
		parameters: {},
	});
	agent.state = 'completed';
	await appContext().agentStateService.save(agent);
}

export async function resumeError(agentId: string, executionId: string, feedback: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been resumed');

	agent.functionCallHistory.push({
		function_name: SUPERVISOR_RESUMED_FUNCTION_NAME,
		stdout: feedback,
		parameters: {},
	});
	agent.error = undefined;
	agent.state = 'agent';
	agent.inputPrompt += `\nSupervisor note: ${feedback}`;
	await appContext().agentStateService.save(agent);
	await runAgent(agent);
}

/**
 * Resume an agent that was in the Human-in-the-loop state
 */
export async function resumeHil(agentId: string, executionId: string, feedback: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been resumed');

	if (feedback.trim().length) {
		agent.functionCallHistory.push({
			function_name: SUPERVISOR_RESUMED_FUNCTION_NAME,
			stdout: feedback,
			parameters: {},
		});
	}
	agent.state = 'agent';
	await appContext().agentStateService.save(agent);
	await runAgent(agent);
}

/**
 * Restart an agent that was in the completed state
 */
export async function resumeCompleted(agentId: string, executionId: string, instructions: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been resumed');

	if (instructions.trim().length) {
		agent.functionCallHistory.push({
			function_name: SUPERVISOR_RESUMED_FUNCTION_NAME,
			stdout: instructions,
			parameters: {},
		});
	}
	agent.state = 'agent';
	agent.inputPrompt += `\nSupervisor note: The agent has been resumed from the completed state with the following instructions: ${instructions}`;
	await appContext().agentStateService.save(agent);
	await runAgent(agent);
}

export async function provideFeedback(agentId: string, executionId: string, feedback: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been provided feedback');

	// The last function call should be the feedback
	const result: FunctionCallResult = agent.functionCallHistory.slice(-1)[0];
	if (result.function_name !== AGENT_REQUEST_FEEDBACK) throw new Error(`Expected the last function call to be ${AGENT_REQUEST_FEEDBACK}`);
	result.stdout = feedback;
	agent.state = 'agent';
	await appContext().agentStateService.save(agent);
	await runAgent(agent);
}

export async function summariseLongFunctionOutput(functionCall: FunctionCall, result: string): Promise<string | null> {
	if (!result || result.length < FUNCTION_OUTPUT_SUMMARIZE_MIN_LENGTH) return null;

	const prompt = `<function_name>${functionCall.function_name}</function_name>\n<output>\n${result}\n</output>\n
	For the above function call summarise the output into a paragraph that captures key details about the output content, which might include identifiers, content summary, content structure and examples. Only responsd with the summary`;
	return await llms().easy.generateText(prompt, { id: 'Summarise long function output' });
}

/**
 * Formats the output of a successful function call
 * @param functionName
 * @param result
 */
export function formatFunctionResult(functionName: string, result: any): string {
	return `<function_results>
        <result>
        <function_name>${functionName}</function_name>
        <stdout>${CDATA_START}
        ${JSON.stringify(result)}
        ${CDATA_END}</stdout>
        </result>
        </function_results>
        `;
}

/**
 * Formats the output of a failed function call
 * @param functionName
 * @param error
 */
export function formatFunctionError(functionName: string, error: any): string {
	return `<function_results>
		<function_name>${functionName}</function_name>
        <error>${CDATA_START}
        ${errorToString(error, false)}
        ${CDATA_END}</error>
        </function_results>`;
}
