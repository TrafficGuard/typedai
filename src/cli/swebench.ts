import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { promises as fs, readFileSync } from 'node:fs';
import type { AgentLLMs } from '#agent/agentContextTypes';
import { AGENT_COMPLETED_PARAM_NAME } from '#agent/orchestrator/functions/agentFunctions';
import { type RunAgentConfig, type RunWorkflowConfig, runAgentAndWait, startAgent } from '#agent/orchestrator/orchestratorAgentRunner';
import { runAgentWorkflow } from '#agent/workflow/workflowAgentRunner';
import { initFirestoreApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { GitLab } from '#functions/scm/gitlab';
import { FileSystemService } from '#functions/storage/fileSystemService';
import { LlmTools } from '#functions/util';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { LlmCall } from '#llm/llmCallService/llmCall';
import { ClaudeLLMs } from '#llm/services/anthropic';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { SWEBenchAgent, type SWEInstance } from '#swe/SWEBenchAgent';
import { CodeEditingAgent } from '#swe/codeEditingAgent';
import { sleep } from '#utils/async-utils';
import { parseProcessArgs, saveAgentId } from './cli';

async function main() {
	const instance = JSON.parse(readFileSync('instance.json').toString()) as SWEInstance;

	await new SWEBenchAgent().runInference(instance);

	if (!process.env.ASDF) return;
	// let args = process.argv.toSpliced(2);
	//
	// args = args.filter(arg => !arg.startsWith('-'))
	// if(!args.length) throw new Error('instanceId is required')

	let agentLlms: AgentLLMs = ClaudeLLMs();
	if (process.env.GCLOUD_PROJECT) {
		await initFirestoreApplicationContext();
		agentLlms = defaultLLMs();
	}

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	console.log(`Prompt: ${initialPrompt}`);

	const config: RunWorkflowConfig = {
		agentName: `SWE-Bench ${instance.instance_id}`,
		subtype: 'code',
		llms: agentLlms,
		initialPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 4,
		},
	};

	const agentId = await runAgentWorkflow(config, async () => {
		await new CodeEditingAgent().implementUserRequirements(config.initialPrompt);
	});

	if (agentId) {
		saveAgentId('swebench', agentId);
	}

	await shutdownTrace();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
