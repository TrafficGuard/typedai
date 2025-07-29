import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { ReasonerDebateLLM } from '#llm/multi-agent/reasoning-debate';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { countTokens } from '#llm/tokens';
import { LLM, ThinkingLevel, contentText, messageText, user } from '#shared/llm/llm.model';
import { LLM_CLI_ALIAS, parseProcessArgs } from './cli';
import { parsePromptWithImages } from './promptParser';

// Usage:
// npm run gen

async function main() {
	await initInMemoryApplicationContext();

	const { initialPrompt: rawPrompt, llmId, flags } = parseProcessArgs();
	const { textPrompt, userContent } = parsePromptWithImages(rawPrompt);

	let llm: LLM = defaultLLMs().medium;
	if (llmId) {
		if (!LLM_CLI_ALIAS[llmId]) {
			console.error(`LLM alias ${llmId} not found. Valid aliases are ${Object.keys(LLM_CLI_ALIAS).join(', ')}`);
			process.exit(1);
		}
		llm = LLM_CLI_ALIAS[llmId]();
	}

	// Count tokens of the text part only for display purposes
	const tokens = await countTokens(textPrompt);
	console.log(`Generating with ${llm.getId()}. Input ${tokens} text tokens\n`);
	const start = Date.now();
	// Pass the full UserContent (text + images) as a message array
	let thinking: ThinkingLevel = 'high';
	if (llm instanceof ReasonerDebateLLM) thinking = 'low';

	const message = await llm.generateMessage([user(userContent)], { id: 'CLI-gen', thinking });

	const text = messageText(message);
	console.log(text);

	const duration = Date.now() - start;

	writeFileSync('src/cli/gen-out', text);

	if (flags.p) {
		try {
			const clipboardy = (await import('clipboardy')).default;
			await clipboardy.write(text);
			console.log('\nCopied output to clipboard.');
		} catch (error) {
			console.error('\nFailed to copy to clipboard. Is `clipboardy` installed? `npm i clipboardy`');
			console.error(error);
		}
	}

	console.log(`\nGenerated ${await countTokens(text)} tokens by ${llm.getId()} in ${(duration / 1000).toFixed(1)} seconds`);
	console.log('Wrote output to src/cli/gen-out');
}

main().catch(console.error);
