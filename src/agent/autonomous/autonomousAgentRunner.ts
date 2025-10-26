import { randomUUID } from 'node:crypto';
import { createContext } from '#agent/agentContextLocalStorage';
import { AgentExecution, agentExecutions } from '#agent/agentExecutions';
import { runCodeGenAgent } from '#agent/autonomous/codegen/codegenAutonomousAgent';
import { AGENT_REQUEST_FEEDBACK } from '#agent/autonomous/functions/agentFeedback';
import { AGENT_COMPLETED_PARAM_NAME } from '#agent/autonomous/functions/agentFunctions';
import { runXmlAgent } from '#agent/autonomous/xml/xmlAutonomousAgent';
import { appContext } from '#app/applicationContext';
import { FUNC_SEP } from '#functionSchema/functions';
import { Git } from '#functions/scm/git';
import { GitHub } from '#functions/scm/github';
import { GitLab } from '#functions/scm/gitlab';
import { logger } from '#o11y/logger';
import type { AgentContext } from '#shared/agent/agent.model';
import type { FunctionCallResult } from '#shared/llm/llm.model';
import { runAsUser } from '#user/userContext';
import { errorToString } from '#utils/errors';
import { CDATA_END, CDATA_START } from '#utils/xml-utils';
import { RunAgentConfig } from './runAgentTypes';

export const SUPERVISOR_RESUMED_FUNCTION_NAME: string = `Supervisor${FUNC_SEP}Resumed`;
export const SUPERVISOR_CANCELLED_FUNCTION_NAME: string = `Supervisor${FUNC_SEP}Cancelled`;

/**
 * Starts a new autonomous agent
 * @param config
 */
export async function startAgent(config: RunAgentConfig): Promise<AgentExecution> {
	const agent: AgentContext = createContext(config);

	if (config.initialPrompt?.includes('<user_request>')) {
		const startIndex = config.initialPrompt.indexOf('<user_request>') + '<user_request>'.length;
		const endIndex = config.initialPrompt.indexOf('</user_request>');
		agent.inputPrompt = config.initialPrompt;
		agent.userPrompt = config.initialPrompt.slice(startIndex, endIndex);
		logger.debug('Extracted <user_request>');
		logger.debug(`agent.userPrompt: ${agent.userPrompt}`);
		logger.debug(`agent.inputPrompt: ${agent.inputPrompt}`);
	} else {
		agent.userPrompt = config.initialPrompt;
		agent.inputPrompt = `<user_request>${config.initialPrompt}</user_request>`;
		logger.debug('Wrapping initialPrompt in <user_request>');
		logger.debug(`agent.userPrompt: ${agent.userPrompt}`);
		logger.debug(`agent.inputPrompt: ${agent.inputPrompt}`);
	}
	await appContext().agentStateService.save(agent);
	logger.info(`Created agent ${agent.agentId}`);

	return await _startAgent(agent);
}

async function _startAgent(agent: AgentContext): Promise<AgentExecution> {
	let execution: AgentExecution;

	await checkRepoHomeAndWorkingDirectory(agent);

	await initialiseMetadataRepository(agent);

	switch (agent.subtype) {
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

async function initialiseMetadataRepository(agent: AgentContext) {
	const metadata = agent.metadata ?? {};
	let hasRepo = false;
	let branch: string | undefined;

	let gitProject = metadata.github?.repository;
	if (gitProject) {
		hasRepo = true;
		await runAsUser(agent.user, async () => {
			branch = metadata.github.branch;
			const repoPath = await new GitHub().cloneProject(gitProject, branch);
			agent.fileSystem!.setWorkingDirectory(repoPath);
		});
	}
	gitProject = metadata.gitlab?.projectPath;
	if (gitProject) {
		hasRepo = true;
		await runAsUser(agent.user, async () => {
			branch = metadata.gitlab.branch;
			const repoPath = await new GitLab().cloneProject(gitProject, branch);
			agent.fileSystem!.setWorkingDirectory(repoPath);
		});
	}
	// If an agent has switched a shared repo from the main/master branch, then switch it back
	if (agent.useSharedRepos && hasRepo && !branch) {
		const git = new Git();
		const currentBranch = await git.getBranchName();
		if (currentBranch !== 'main' && currentBranch !== 'master') {
			logger.warn(`Shared repo ${gitProject} is not on branch main or master, switching back`);
			try {
				await git.switchToBranch('main');
			} catch (e) {
				try {
					await git.switchToBranch('master');
				} catch (e) {
					logger.warn({ metadata }, 'Couldnt restore branch to `main` or `master`', e);
				}
			}
		}
	}
}

export async function startAgentAndWaitForCompletion(config: RunAgentConfig): Promise<string> {
	const agentExecution = await startAgent(config);

	// Wait for the initial execution promise to settle, but also poll for terminal state
	// as the promise might resolve early in fire-and-forget scenarios.
	try {
		await agentExecution.execution;
	} catch (e) {
		logger.warn(e, `Agent execution promise for ${agentExecution.agentId} rejected. Polling for final state.`);
	}

	// Polling loop to ensure we wait until the agent is in a terminal state.
	const poll = async (agentId: string): Promise<void> => {
		const terminalStates = ['completed', 'error', 'cancelled'];
		let agent = await appContext().agentStateService.load(agentId);
		if (!agent) throw new Error(`Agent ${agentId} not found to wait for completion`);

		while (!terminalStates.includes(agent.state)) {
			await new Promise((resolve) => setTimeout(resolve, 2000)); // Poll every 2 seconds
			agent = await appContext().agentStateService.load(agentId);
			if (!agent) throw new Error(`Agent ${agentId} not found to wait for completion`);
			logger.debug(`Polling agent ${agentId}, current state: ${agent.state}`);
		}
	};

	await poll(agentExecution.agentId);

	const agent = await appContext().agentStateService.load(agentExecution.agentId);
	if (!agent) throw new Error(`Agent ${agentExecution.agentId} not found`);

	if (agent.state !== 'completed') {
		const errorMessage = agent.error ? errorToString(agent.error as any) : `Agent finished in non-completed state: ${agent.state}`;
		throw new Error(errorMessage);
	}

	const lastCall = agent.functionCallHistory.at(-1);
	if (!lastCall || !lastCall.parameters || !(AGENT_COMPLETED_PARAM_NAME in lastCall.parameters)) {
		throw new Error('Agent completed, but could not find the final result note.');
	}

	return lastCall.parameters[AGENT_COMPLETED_PARAM_NAME];
}

export async function runAgentAndWait(config: RunAgentConfig): Promise<string> {
	const agentExecution = await startAgent(config);
	await agentExecution.execution;
	return agentExecution.agentId;
}

export async function cancelAgent(agentId: string, executionId: string, feedback: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (!agent) throw new Error(`Agent ${agentId} not found to cancel`);
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
	if (!agent) throw new Error(`Agent ${agentId} not found to resume`);
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
	await _startAgent(agent);
}

/**
 * Resume an agent that was in the Human-in-the-loop state
 */
export async function resumeHil(agentId: string, executionId: string, feedback: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (!agent) throw new Error(`Agent ${agentId} not found to resume HIL`);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been resumed');

	// Check if the agent is in a state appropriate for this generic resume function
	if (
		agent.state === 'hitl_user' ||
		agent.state === 'hitl_threshold' ||
		agent.state === 'hitl_tool'
		// Add other states here if they should use this resume path
	) {
		if (agent.state === 'hitl_user') {
			agent.hilRequested = false; // Clear the flag for UI-requested HIL
		}

		if (feedback.trim().length) {
			agent.functionCallHistory.push({
				function_name: SUPERVISOR_RESUMED_FUNCTION_NAME,
				stdout: feedback,
				parameters: {},
			});
		}
		agent.state = 'agent'; // Transition back to agent state for next execution cycle
		await appContext().agentStateService.save(agent);
		await _startAgent(agent); // Resume execution
	} else {
		// If called for an inappropriate state (e.g., 'hitl_feedback', 'completed', 'error')
		throw new Error(
			`Agent in state '${agent.state}' cannot be resumed using resumeHil. Use the appropriate resume function (e.g., provideFeedback, resumeError, resumeCompleted).`,
		);
	}
}

/**
 * Restart an agent that was in the completed state
 */
export async function resumeCompleted(agentId: string, executionId: string, instructions: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (!agent) throw new Error(`Agent ${agentId} not found to resume`);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been resumed');

	// Generate New Execution Identifiers
	agent.executionId = randomUUID();
	agent.traceId = randomUUID(); // Or use an existing trace ID generation mechanism

	// Reset Execution-Specific Fields
	agent.callStack = [];
	agent.error = undefined;
	agent.output = undefined;
	agent.iterations = 0;
	agent.invoking = [];
	agent.notes = [];
	agent.messages = [];
	agent.functionCallHistory = []; // Reset history before adding the resume event
	agent.hilCount = 0;
	agent.hilRequested = false;
	agent.toolState = undefined;
	agent.budgetRemaining = agent.hilBudget; // Reset remaining budget to full HIL budget
	agent.lastUpdate = Date.now();

	// Add Resume Event to History
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
	await _startAgent(agent);
}

/**
 * Restart a chatbot agent that was in the completed state
 */
export async function resumeCompletedWithUpdatedUserRequest(agentId: string, executionId: string, userRequest: string): Promise<AgentExecution> {
	const agent = await appContext().agentStateService.load(agentId);
	if (!agent) throw new Error(`Agent ${agentId} not found to resume`);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been resumed');

	agent.inputPrompt = agent.inputPrompt.replace(agent.userPrompt, userRequest);
	agent.userPrompt = userRequest;

	agent.state = 'agent';
	await appContext().agentStateService.save(agent);
	return await _startAgent(agent);
}

export async function provideFeedback(agentId: string, executionId: string, feedback: string): Promise<void> {
	const agent = await appContext().agentStateService.load(agentId);
	if (!agent) throw new Error(`Agent ${agentId} not found to provide feedback`);
	if (agent.executionId !== executionId) throw new Error('Invalid executionId. Agent has already been provided feedback');

	// This function is specifically for when the agent is in 'hitl_feedback' state
	if (agent.state !== 'hitl_feedback') {
		throw new Error(`Agent is not in 'hitl_feedback' state. Current state: ${agent.state}. Cannot use provideFeedback.`);
	}

	// The last function call should be the AGENT_REQUEST_FEEDBACK
	const result: FunctionCallResult | undefined = agent.functionCallHistory.at(-1); // Use .at(-1) for safety
	if (!result || result.function_name !== AGENT_REQUEST_FEEDBACK) {
		throw new Error(`Expected the last function call in history to be ${AGENT_REQUEST_FEEDBACK} when in 'hitl_feedback' state.`);
	}
	result.stdout = feedback; // Provide feedback as output of the agent's request
	agent.state = 'agent';
	await appContext().agentStateService.save(agent);
	await _startAgent(agent);
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

/**
 * If the agent has been restarted on a different machine then update the working directory if required
 * @param agent
 */
async function checkRepoHomeAndWorkingDirectory(agent: AgentContext) {
	const fss = agent.fileSystem;
	if (!fss) return;

	const currentRepoDir = process.env.TYPEDAI_HOME || process.cwd();
	if (!agent.typedAiRepoDir) {
		// Migration for old agents
		agent.typedAiRepoDir = currentRepoDir;
	} else if (agent.typedAiRepoDir !== currentRepoDir) {
		if (fss.getWorkingDirectory().startsWith(agent.typedAiRepoDir)) {
			const originalDir = fss.getWorkingDirectory();
			const updatedDir = originalDir.replace(agent.typedAiRepoDir, currentRepoDir);
			logger.info(`Updating working directory from ${originalDir} to ${updatedDir}`);
			fss.setWorkingDirectory(updatedDir);
		}
		agent.typedAiRepoDir = currentRepoDir;
	}
	const workingDir = fss.getWorkingDirectory();
	const workDirExists = await fss.directoryExists(workingDir);
	if (!workDirExists) throw new Error(`Working directory ${workingDir} does not exist or is not a directory.`);
}
