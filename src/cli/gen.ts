import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'fs';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { countTokens } from '#llm/tokens';
import { parseProcessArgs } from './cli';

// Usage:
// npm run gen

async function main() {
	const llms = defaultLLMs();

	const { initialPrompt } = parseProcessArgs();

	const llm = llms.medium;
	const tokens = await countTokens(initialPrompt);
	console.log(`Generating with ${llm.getId()}. Input ${tokens} tokens\n`);
	const start = Date.now();
	const text = await llm.generateText(initialPrompt);
	const duration = Date.now() - start;

	writeFileSync('src/cli/gen-out', text);

	console.log(text);
	console.log(`\nGenerated ${await countTokens(text)} tokens by ${llm.getId()} in ${(duration / 1000).toFixed(1)} seconds`);
	console.log('Wrote output to src/cli/gen-out');
}

main().catch(console.error);
