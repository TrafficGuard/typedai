import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import { PublicWeb } from '#functions/web/web';
import { countTokens } from '#llm/tokens';

// npm run scrape <URL> <filename(optional)>

async function url2markdown(url: string, outputFilename?: string) {
	if (!URL.canParse(url)) throw new Error(`Invalid URL ${url}`);
	console.log(`Scraping ${url}`);
	agentContextStorage.enterWith(
		createContext({
			subtype: 'scrape',
			initialPrompt: '',
			agentName: '',
		}),
	);

	const markdown = await new PublicWeb().getWebPage(url);
	const file = outputFilename ?? 'scrape.md';
	writeFileSync(file, markdown);
	const tokens = await countTokens(markdown);
	console.log(`Written ${tokens} tokens to ${file}`);
}

const args = process.argv
	.slice(2) // ignore “node … scrape.ts”
	.filter((arg) => !arg.startsWith('--fs=')); // drop the --fs flag

const [url, outFile] = args;

if (!url) {
	console.error('Pass the URL to scrape as the argument');
	process.exit(1);
}

url2markdown(url, outFile).catch(console.error);
