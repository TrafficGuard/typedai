import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { LlmFunctionsImpl } from '#agent/LlmFunctionsImpl';
import { agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import type { RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { appContext } from '#app/applicationContext';
import { Jira } from '#functions/jira';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { MultiLLM } from '#llm/multi-llm';
import { Claude3_5_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { GPT41 } from '#llm/services/openai';
import type { AgentContext, AgentLLMs } from '#shared/model/agent.model';
import { SearchReplaceCoder } from '#swe/coder/searchReplaceCoder';
import { envVarHumanInLoopSettings } from './cliHumanInLoop';

// For running random bits of code
// Usage:
// npm run util

const sonnet = Claude3_5_Sonnet_Vertex();

const utilLLMs: AgentLLMs = {
	easy: sonnet,
	medium: sonnet,
	hard: sonnet,
	xhard: new MultiLLM([sonnet, GPT41()], 3),
};

async function main() {
	await appContext().userService.ensureSingleUser();
	const functions = new LlmFunctionsImpl();
	functions.addFunctionClass(FileSystemService);

	const config: RunWorkflowConfig = {
		agentName: 'util',
		subtype: 'util',
		llms: utilLLMs,
		functions,
		initialPrompt: '',
		humanInLoop: envVarHumanInLoopSettings(),
	};

	const context: AgentContext = createContext(config);

	agentContextStorage.enterWith(context);
}

main()
	.then(() => {
		console.log('done');
	})
	.catch((e) => {
		console.error(e);
	});
