import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { readFileSync } from 'node:fs';
import { initInMemoryApplicationContext } from '#app/applicationContext';
import { convertFormatting } from '#functions/jira';
import { parseProcessArgs } from './cli';

// Usage:
// ai format-jira 'markdown text to convert'
// echo "markdown text" | npx ts-node src/cli/format-jira.ts
// ai format-jira -i  (then paste text and Ctrl+D)

async function main() {
	const { initialPrompt, flags } = parseProcessArgs();

	// Initialize in-memory context for LLM access (required by convertFormatting)
	initInMemoryApplicationContext();

	let input = initialPrompt;

	// If no input provided and -i flag not set, prompt for interactive input
	if (!input.trim() && !flags.i) {
		console.log('Enter Markdown text to convert (Ctrl+D on a new line to finish):');
		input = readFileSync(0, 'utf-8').trim();
	}

	if (!input.trim()) {
		console.error('No input provided');
		process.exit(1);
	}

	const result = await convertFormatting(input);
	console.log(result);
}

main().catch(console.error);
