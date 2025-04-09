import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { readFileSync } from 'node:fs';

import type { AgentLLMs } from '#agent/agentContextTypes';
import { startAgentAndWait } from '#agent/agentRunner';
import { Perplexity } from '#functions/web/perplexity';
import { PublicWeb } from '#functions/web/web';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { parseProcessArgs, saveAgentId } from './cli';

// Usage:
// npm run research

const llms: AgentLLMs = defaultLLMs();

export async function main() {
	const systemPrompt = readFileSync('src/cli/research-system', 'utf-8');

	const { initialPrompt, resumeAgentId } = parseProcessArgs();

	const agentId = await startAgentAndWait({
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
