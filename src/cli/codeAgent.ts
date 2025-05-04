import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { LlmFunctions } from '#agent/LlmFunctions';
import { llms } from '#agent/agentContextLocalStorage';
import { AgentFeedback } from '#agent/agentFeedback';
import { provideFeedback, resumeCompleted, resumeError, resumeHil, startAgent } from '#agent/agentRunner';
import { waitForConsoleInput } from '#agent/humanInTheLoop';
import { LiveFiles } from '#agent/liveFiles';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { FileSystemList } from '#functions/storage/fileSystemList';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { CodeFunctions } from '#swe/codeFunctions';
import { parseProcessArgs, saveAgentId } from './cli';
import { resolveFunctionClasses } from './functionResolver';

export async function main() {
	const llms = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId, functionClasses } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	if (resumeAgentId) {
		const agent = await appContext().agentStateService.load(resumeAgentId);
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
				await waitForConsoleInput(`Agent is currently in the state ${agent.state}. Only resume if you know it is not `);
				return resumeError(resumeAgentId, agent.executionId, initialPrompt);
		}
	}

	// Could let the user add additional tools
	// let functions: LlmFunctions | Array<new () => any>;
	// if (functionClasses?.length) {
	//     functions = await resolveFunctionClasses(functionClasses);
	// } else {
	//     // Default to FileSystemRead if no functions specified
	//     functions = [FileSystemRead];
	// }
	// functions.push(AgentFeedback);
	// logger.info(`Available tools ${functions.map((f) => f.name).join(', ')}`);
	const functions = [PublicWeb, CodeFunctions, FileSystemList, LiveFiles, AgentFeedback, Perplexity, CodeEditingAgent];

	const fullPrompt = `${initialPrompt}Actions:

- Call getFileSystemTreeWithFileSummaries and save all the relevant file paths to memory.
  Then
- Use the CodeFunctions_findRelevantFiles to to quickly get an initial file list to add to the LiveFiles 
- Use LiveFile to view the files. These will always show the current file contents after functions/agents modifies it.
- Use LiveFiles and the diff results from the code editing agent to understand the current state of the code base and to determine what needs to be done next.
- After verifying changes from the code editing agent diff and/or viewing file contents with LiveFiles, then add a completed item to the plan.
- Minimize the files loaded with LiveFiles to the essentials to reduce LLM token costs. Remove files from LiveFiles no longer required.
- Implement this functionality in multiple small pieces through multiple calls to the code editing agent to minimize the token size of the LLM calls, and to make smaller, simpler tasks to complete at one time.
- Provide a detailed implementation plan to the code editing agent for the small set of changes to make at a time.
- If you get stuck on a step, you can provide a mock/fake implementation and make a note in memory. Then continue on to the next steps. Only request feedback if you are really stuck.
- You are working in an existing codebase. Use the CodeFunctions_queryRepository to ask questions about the codebase to ensure you are making the correct changes.
- Write tests but dont spend too long on then if you are having difficulties writing the tests. You can always add a describe.skip and we'll come back to it later.
`;
	const agentName = await defaultLLMs().easy.generateText(
		`<instructions>\n${initialPrompt}\n</instructions>\n\nSummarise the instructions into short sentence for the descriptive name of the AI agent completing the task. Output the name only, nothing else.`,
		{ id: 'CodeAgent name' },
	);

	logger.info('Starting new agent');
	const execution = await startAgent({
		agentName,
		initialPrompt: fullPrompt,
		functions,
		llms,
		type: 'autonomous',
		subtype: 'codegen',
		resumeAgentId,
		humanInLoop: {
			count: 10,
			budget: 10,
		},
	});
	saveAgentId('codeAgent', execution.agentId);
	await execution.execution;
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
