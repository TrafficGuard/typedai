import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { countTokens } from '#llm/tokens';
import { parseProcessArgs } from './cli';
import { loadCliEnvironment } from './envLoader';
import { parsePromptWithImages } from './promptParser';

// Usage:
// ai tokens 'text to count the tokens'

async function main() {
	loadCliEnvironment();
	const { initialPrompt: rawPrompt, llmId, flags } = parseProcessArgs();
	const { textPrompt, userContent } = await parsePromptWithImages(rawPrompt);

	const tokens = await countTokens(textPrompt);
	console.log(`${tokens} text tokens`);
}

main().catch(console.error);
