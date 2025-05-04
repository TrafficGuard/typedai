import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import type { AgentLLMs } from '#agent/agentContextTypes';
import type { RunAgentConfig, RunWorkflowConfig } from '#agent/orchestrator/orchestratorAgentRunner';
import { runAgentWorkflow } from '#agent/workflow/workflowAgentRunner';
import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { performLocalBranchCodeReview } from '#swe/codeReview/local/localCodeReview';
import { beep } from '#utils/beep';
import { parseProcessArgs } from './cli';

async function main() {
	const agentLlms: AgentLLMs = defaultLLMs();
	await initApplicationContext();

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	const config: RunWorkflowConfig = {
		agentName: 'review-branch',
		subtype: 'local-review',
		llms: agentLlms,
		initialPrompt,
		resumeAgentId,
		humanInLoop: {
			budget: 2,
		},
	};

	await runAgentWorkflow(config, async () => {
		await performLocalBranchCodeReview();
	});

	await beep();
	await shutdownTrace();
}

main().then(
	() => console.log('done'),
	(e) => console.error(e),
);
