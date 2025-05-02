import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { AgentContext, AgentLLMs } from '#agent/agentContextTypes';
import type { RunWorkflowConfig } from '#agent/agentRunner';
import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
import { initApplicationContext } from '#app/applicationContext';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { Perplexity } from '#functions/web/perplexity';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { SoftwareDeveloperAgent } from '#swe/softwareDeveloperAgent';
import { parseProcessArgs, saveAgentId } from './cli';

// Used to test the SoftwareDeveloperAgent

// Usage:
// npm run swe

async function main() {
	const llms: AgentLLMs = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	const config: RunWorkflowConfig = {
		agentName: 'cli-SWE',
		subtype: 'swe',
		llms,
		functions: [FileSystemRead, CodeEditingAgent, Perplexity],
		initialPrompt: initialPrompt.trim(),
		resumeAgentId,
	};

	await runAgentWorkflow(config, async (agent: AgentContext) => {
		await new SoftwareDeveloperAgent().runSoftwareDeveloperWorkflow(config.initialPrompt);
		if (agent.agentId) {
			saveAgentId('swe', agent.agentId);
		}
	});
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
