import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { AgentLLMs } from '#agent/agentContextTypes';
import type { RunAgentConfig, RunWorkflowConfig } from '#agent/agentRunner';
import { runAgentWorkflow } from '#agent/agentWorkflowRunner';
import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { buildIndexDocs } from '#swe/index/repoIndexDocBuilder';
import { generateRepositoryMaps } from '#swe/index/repositoryMap';
import { detectProjectInfo } from '#swe/projectDetection';
import { parseProcessArgs, saveAgentId } from './cli';

async function main() {
	const agentLlms: AgentLLMs = defaultLLMs();
	await initApplicationContext();

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

	const maps = await generateRepositoryMaps(await detectProjectInfo());

	console.log(`languageProjectMap ${maps.languageProjectMap.tokens} tokens`);
	console.log(`fileSystemTree ${maps.fileSystemTree.tokens} tokens`);
	console.log(`folderSystemTreeWithSummaries ${maps.folderSystemTreeWithSummaries.tokens} tokens`);

	if (console.log) return;

	const agentId = await runAgentWorkflow(config, async () => {
		await buildIndexDocs();
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
