import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { provideFeedback, resumeCompleted, resumeError, resumeHil, startAgent } from '#agent/autonomous/autonomousAgentRunner';
import { AgentFeedback } from '#agent/autonomous/functions/agentFeedback';
import { FileSystemTree } from '#agent/autonomous/functions/fileSystemTree';
import { LiveFiles } from '#agent/autonomous/functions/liveFiles';
import { humanInTheLoop } from '#agent/autonomous/humanInTheLoop';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { DeepThink } from '#functions/deepThink';
import { Jira } from '#functions/jira';
import { Git } from '#functions/scm/git';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { Slack } from '#modules/slack/slack';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { CodeFunctions } from '#swe/codeFunctions';
import { MorphEditor } from '#swe/morph/morphEditor';
import { registerErrorHandlers } from '../errorHandlers';
import { parseProcessArgs, saveAgentId } from './cli';
import { resolveFunctionClasses } from './functionAliases';

async function resumeAgent(resumeAgentId: string, initialPrompt: string) {
	const agent = await appContext().agentStateService.load(resumeAgentId);
	if (!agent) throw new Error(`No agent exists with id ${resumeAgentId}`);
	switch (agent.state) {
		case 'completed':
			return await resumeCompleted(resumeAgentId, agent.executionId, initialPrompt);
		case 'error':
			return resumeError(resumeAgentId, agent.executionId, initialPrompt);
		case 'hitl_threshold':
		case 'hitl_tool':
			return await resumeHil(resumeAgentId, agent.executionId, initialPrompt);
		case 'hitl_feedback':
			return await provideFeedback(resumeAgentId, agent.executionId, initialPrompt);
		default:
			await humanInTheLoop(agent, `Agent is currently in the state "${agent.state}". Only resume if you know it is not `);
			return resumeError(resumeAgentId, agent.executionId, initialPrompt);
	}
}

export async function main(): Promise<void> {
	registerErrorHandlers();
	await initApplicationContext();
	const llms = defaultLLMs();

	const { initialPrompt, resumeAgentId, functionClasses } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);
	console.log(`resumeAgentId: ${resumeAgentId}`);

	if (resumeAgentId) {
		await resumeAgent(resumeAgentId, initialPrompt);
		console.log('Resume this agent by running:');
		console.log(`ai codeAgent -r=${resumeAgentId}`);
		return;
	}

	const functions = [
		// AgentFeedback,
		// PublicWeb,
		CodeFunctions,
		FileSystemList,
		FileSystemTree,
		LiveFiles,
		Perplexity,
		MorphEditor,
		// CodeEditingAgent,
		// Git,
		// GitLab,
		// DeepThink,
		// Jira,
		// Slack,
	];
	// Add any additional functions provided from CLI args
	let additionalFunctions: Array<new () => any> = [];
	if (functionClasses?.length) {
		additionalFunctions = await resolveFunctionClasses(functionClasses);
	}
	functions.push(...additionalFunctions);
	logger.info(`Available functions ${functions.map((f) => f.name).join(', ')}`);

	const fullPrompt = `# General function calling guidelines for code tasks

- Use FileSystemTree_collapseFolder to hide unrelated folders for the current task to minimize token usage.
- Use the CodeFunctions_findRelevantFiles to to quickly get an initial file list to add to the LiveFiles 
- Use LiveFile to view the files. These will always show the current file contents after functions/agents modifies it.
- Use LiveFiles to understand the current state of the code base and to determine what needs to be done next.
- After verifying changes from the code editing agent by viewing file contents with LiveFiles (an optionally the diff), then add a completed item to the plan.
- Minimize the files loaded with LiveFiles to the essentials to reduce LLM token costs. Remove files from LiveFiles no longer required.
- Implement this functionality in multiple small pieces through multiple calls to the code editing agent to minimize the token size of the LLM calls, and to make smaller, simpler tasks to complete at one time.
- Provide a detailed implementation plan to the code editing agent for the small set of changes to make at a time.
- If you get stuck on a step, you can provide a mock/fake implementation and make a note in memory. Then continue on to the next steps. Only request feedback if you are really stuck.
- You are working in an existing codebase. Use the CodeFunctions_queryRepository to ask questions about the codebase to ensure you are making the correct changes.
- Write tests but dont spend too long on then if you are having difficulties writing the tests. You can always add a describe.skip and we'll come back to it later.
- Use DeepThink when generating a detailed implementation plan for the code editing agent.
- Use DeepThink, along with online research with Perplexity if relevant, when stuck on compile/test errors.

# Requirements

${initialPrompt}
`;
	const agentName = await defaultLLMs().easy.generateText(
		`<instructions>\n${initialPrompt}\n</instructions>\n\nSummarise the instructions into short sentence for the descriptive name of the AI agent completing the task. Output the name only, nothing else.`,
		{ id: 'CodeAgent name' },
	);

	logger.info('Starting new codeAgent');
	const execution = await startAgent({
		agentName,
		initialPrompt: fullPrompt,
		functions: functions,
		llms,
		type: 'autonomous',
		subtype: 'codegen',
		resumeAgentId,
		humanInLoop: {
			count: 60,
			budget: 20,
		},
	});
	saveAgentId('codeAgent', execution.agentId);
	try {
		await execution.execution;
	} catch (e) {
		console.log(e);
	}

	console.log('Resume this agent by running:');
	console.log(`ai codeAgent -r=${execution.agentId}`);
}

main().catch(console.error);
