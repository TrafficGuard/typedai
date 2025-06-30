import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { countTokens } from '#llm/tokens';
import { LLM, messageText, user } from '#shared/llm/llm.model';
import { LLM_CLI_ALIAS, parseProcessArgs } from './cli';
import { parsePromptWithImages } from './promptParser';

// Usage:
// npm run gen

async function main() {
	await initInMemoryApplicationContext();

	const { initialPrompt: rawPrompt, llmId } = parseProcessArgs();
	const { textPrompt, userContent } = parsePromptWithImages(rawPrompt);

	const llm: LLM = llmId && LLM_CLI_ALIAS[llmId] ? LLM_CLI_ALIAS[llmId]() : defaultLLMs().medium;

	// Count tokens of the text part only for display purposes
	const tokens = await countTokens(textPrompt);
	console.log(`Generating with ${llm.getId()}. Input ${tokens} text tokens\n`);
	const start = Date.now();
	// Pass the full UserContent (text + images) as a message array
	const message = await llm.generateMessage([user(userContent)], { id: 'CLI-gen', thinking: 'high' });
	const text = messageText(message);

	const duration = Date.now() - start;

	writeFileSync('src/cli/gen-out', text);

	console.log(text);
	console.log(`\nGenerated ${await countTokens(text)} tokens by ${llm.getId()} in ${(duration / 1000).toFixed(1)} seconds`);
	console.log('Wrote output to src/cli/gen-out');
}

main().catch(console.error);
