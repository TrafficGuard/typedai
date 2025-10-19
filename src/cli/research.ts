import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { readFileSync } from 'node:fs';

import { runAgentAndWait } from '#agent/autonomous/autonomousAgentRunner';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { defaultLLMs } from '#llm/services/defaultLlms';
import type { AgentLLMs } from '#shared/agent/agent.model';
import { parseProcessArgs, saveAgentId } from './cli';
import { loadCliEnvironment } from './envLoader';

// Usage:
// npm run research

const llms: AgentLLMs = defaultLLMs();

export async function main(): Promise<void> {
	loadCliEnvironment();
	const systemPrompt = readFileSync('src/cli/research-system', 'utf-8');

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	const agentId = await runAgentAndWait({
		type: 'autonomous',
		subtype: 'codegen',
		agentName: 'researcher',
		initialPrompt,
		systemPrompt,
		functions: [Perplexity, PublicWeb],
		llms,
		resumeAgentId,
	});

	if (agentId) {
		saveAgentId('research', agentId);
	}
}

main()
	.then(() => console.log('done'))
	.catch((e) => console.error(e));
