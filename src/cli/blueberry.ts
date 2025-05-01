import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContext, agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import type { AgentContext } from '#agent/agentContextTypes';
import { initApplicationContext } from '#app/applicationContext';
import { Blueberry } from '#llm/multi-agent/blueberry';
import { mockLLMs } from '#llm/services/mock-llm';
import { parseProcessArgs, saveAgentId } from './cli';

// Usage:
// npm run blueberry

async function main() {
	await initApplicationContext();
	const { initialPrompt } = parseProcessArgs();

	const context: AgentContext = createContext({
		subtype: 'blueberry',
		initialPrompt,
		agentName: 'blueberry',
		llms: mockLLMs(),
		functions: [],
	});
	agentContextStorage.enterWith(context);

	const text = await new Blueberry().generateText(initialPrompt);

	writeFileSync('src/cli/blueberry-out', text);

	console.log(text);
	console.log('Wrote output to src/cli/blueberry-out');
	console.log(`Cost USD$${agentContext().cost.toFixed(2)}`);

	// Save the agent ID after a successful run
	saveAgentId('blueberry', context.agentId);
}

main()
	.then(() => {
		console.log('done');
	})
	.catch((e) => {
		console.error(e);
	});
