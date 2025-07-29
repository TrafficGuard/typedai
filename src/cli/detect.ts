import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { detectProjectInfo } from 'dist/src/swe/projectDetection';
import { agentContext } from '#agent/agentContextLocalStorage';
import type { RunWorkflowConfig } from '#agent/autonomous/autonomousAgentRunner';
import { runWorkflowAgent } from '#agent/workflow/workflowAgentRunner';
import { initApplicationContext } from '#app/applicationContext';
import { shutdownTrace } from '#fastify/trace-init/trace-init';
import { defaultLLMs } from '#llm/services/defaultLlms';
import type { AgentLLMs } from '#shared/agent/agent.model';

async function main() {
	await initApplicationContext();
	const agentLLMs: AgentLLMs = defaultLLMs();

	const config: RunWorkflowConfig = {
		agentName: 'Detect project commands',
		subtype: 'detect-project-commands',
		llms: agentLLMs,
		functions: [],
		initialPrompt: '',
		resumeAgentId: undefined,
		humanInLoop: {
			budget: 2,
		},
	};

	console.log('Detecting project commands');

	await runWorkflowAgent(config, async () => {
		const agent = agentContext();
		const projectInfo = await detectProjectInfo();
		console.log(projectInfo);
		console.log('Written to .typedai.json');
	});

	await shutdownTrace();
}

main().catch(console.error);
