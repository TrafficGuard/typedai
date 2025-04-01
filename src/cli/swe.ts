import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { AgentContext, AgentLLMs } from '#agent/agentContextTypes';
import { RunAgentConfig } from '#agent/agentRunner';
import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
import { FileSystemRead } from '#functions/storage/fileSystemRead';
import { Perplexity } from '#functions/web/perplexity';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { SoftwareDeveloperAgent } from '#swe/softwareDeveloperAgent';
import { initApplicationContext } from '../applicationContext';
import { parseProcessArgs, saveAgentId } from './cli';

// Used to test the SoftwareDeveloperAgent

// Usage:
// npm run swe

async function main() {
	const llms: AgentLLMs = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	const config: RunAgentConfig = {
		agentName: 'cli-SWE',
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
