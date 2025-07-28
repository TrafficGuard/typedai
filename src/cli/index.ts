import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { llms } from '#agent/agentContextLocalStorage';
import type { RunAgentConfig, RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { buildIndexDocs } from '#swe/index/repoIndexDocBuilder';
import { generateRepositoryMaps } from '#swe/index/repositoryMap';
import { getProjectInfos } from '#swe/projectDetection';
import { parseProcessArgs, saveAgentId } from './cli';

async function main() {
	await initApplicationContext();
	const agentLlms: AgentLLMs = defaultLLMs();

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	const config: RunWorkflowConfig = {
		agentName: 'repo-index',
		subtype: 'repo-index',
		llms: agentLlms,
		initialPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	const maps = await generateRepositoryMaps(await getProjectInfos());

	console.log(`languageProjectMap ${maps.languageProjectMap.tokens} tokens`);
	console.log(`fileSystemTree ${maps.fileSystemTree.tokens} tokens`);
	console.log(`folderSystemTreeWithSummaries ${maps.folderSystemTreeWithSummaries.tokens} tokens`);

	// if (console.log) return;

	const agentId = await runWorkflowAgent(config, async () => {
		await buildIndexDocs(llms().easy);
	});

	if (agentId) {
		saveAgentId('docs', agentId);
	}

	await shutdownTrace();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
