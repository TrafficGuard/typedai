import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import type { RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { appContext } from '#app/applicationContext';
import { Jira } from '#functions/jira';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { MultiLLM } from '#llm/multi-llm';
import { Claude4_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { GPT41 } from '#llm/services/openai';
import type { AgentContext, AgentLLMs } from '#shared/model/agent.model';
import { SearchReplaceCoder } from '#swe/coder/searchReplaceCoder';
import { envVarHumanInLoopSettings } from './cliHumanInLoop';

// For running random bits of code
// Usage:
// npm run util

async function main() {
	await appContext().userService.ensureSingleUser();
	const functions = new LlmFunctionsImpl();
	functions.addFunctionClass(FileSystemService);

	const config: RunWorkflowConfig = {
		agentName: 'util',
		subtype: 'util',
		llms: defaultLLMs(),
		functions,
		initialPrompt: '',
		humanInLoop: envVarHumanInLoopSettings(),
		useSharedRepos: true,
	};

	const context: AgentContext = createContext(config);

	agentContextStorage.enterWith(context);

	const gitlab = new GitLab();

	const projects = await gitlab.getProjects();
	console.log(projects);
	const cloned = await gitlab.cloneProject('devops/terraform/waf_infra', 'main');
	console.log(cloned);

	// console.log(await new Jira().getJiraDetails('CLD-1685'));

	// const edited = await new SearchReplaceCoder().editFilesToMeetRequirements(
	// 	'Add another button, after the toggle thinking button, with the markdown material icon which calls a function called reformat() method on the component',
	// 	['frontend/src/app/modules/chat/conversation/conversation.component.html', 'frontend/src/app/modules/chat/conversation/conversation.component.ts'],
	// 	[],
	// );
	// console.log(edited);
}

main()
	.then(() => {
		console.log('done');
	})
	.catch((e) => {
		console.error(e);
	});
