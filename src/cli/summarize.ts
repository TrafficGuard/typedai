import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import type { AgentLLMs } from '#agent/agentContextTypes';
import type { RunAgentConfig, RunWorkflowConfig } from '#agent/agentRunner';
import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { SummarizerAgent } from '#functions/text/summarizer';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { initApplicationContext } from '../applicationContext';
import { parseProcessArgs, saveAgentId } from './cli';

async function main() {
	const agentLlms: AgentLLMs = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	const config: RunWorkflowConfig = {
		agentName: `Summarize: ${initialPrompt.substring(0, initialPrompt.length > 20 ? 20 : initialPrompt.length)}`,
		subtype: 'summarize',
		llms: agentLlms,
		initialPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	const agentId = await runAgentWorkflow(config, async () => {
		const response = await new SummarizerAgent().summarizeTranscript(initialPrompt, 2);
		console.log(response);
		writeFileSync('src/cli/summarize-out', response);
		console.log('Wrote output to src/cli/summarize-out');
	});

	if (agentId) {
		saveAgentId('summarize', agentId);
	}

	await shutdownTrace();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
