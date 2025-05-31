import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { vertexGemini_2_5_Flash } from '#llm/services/vertexai';
import { countTokens } from '#llm/tokens';
import { messageText, user } from '#shared/model/llm.model';
import { parseProcessArgs } from './cli';
import { parsePromptWithImages } from './promptParser';

// Usage:
// npm run gen

async function main() {
	const llms = defaultLLMs();

	const { initialPrompt: rawPrompt } = parseProcessArgs();
	const { textPrompt, userContent } = parsePromptWithImages(rawPrompt);

	await countTokens('asdf'); // so countTokensSync works in calculation costs

	const llm = vertexGemini_2_5_Flash(); //  llms.medium;
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
