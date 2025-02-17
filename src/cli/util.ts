import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { LlmFunctions } from '#agent/LlmFunctions';
import { agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import { AgentContext, AgentLLMs } from '#agent/agentContextTypes';
import { RunAgentConfig } from '#agent/agentRunner';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { MultiLLM } from '#llm/multi-llm';
import { Claude3_5_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import { GPT4o } from '#llm/services/openai';
import { appContext } from '../applicationContext';
import { envVarHumanInLoopSettings } from './cliHumanInLoop';

// For running random bits of code
// Usage:
// npm run util

const sonnet = Claude3_5_Sonnet_Vertex();

const utilLLMs: AgentLLMs = {
	easy: sonnet,
	medium: sonnet,
	hard: sonnet,
	xhard: new MultiLLM([sonnet, GPT4o()], 3),
};

async function main() {
	await appContext().userService.ensureSingleUser();
	const functions = new LlmFunctions();
	functions.addFunctionClass(FileSystemService);

	const config: RunAgentConfig = {
		agentName: 'util',
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
