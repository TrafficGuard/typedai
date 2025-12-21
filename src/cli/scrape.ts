import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContextStorage } from '#agent/agentContext';
import { createContext } from '#agent/agentContextUtils';
import { countTokens } from '#llm/tokens';
import { terminalLog } from './terminal';

// npm run scrape <URL> <filename(optional)>

async function url2markdown(url: string, outputFilename?: string) {
	if (!URL.canParse(url)) throw new Error(`Invalid URL ${url}`);
	terminalLog(`Scraping ${url}`);
	agentContextStorage.enterWith(
		createContext({
			subtype: 'scrape',
			initialPrompt: '',
			agentName: '',
		}),
	);

	const { default: functionModules } = await import('../functions/functionModules.cjs');
	const markdown = await new functionModules.web.PublicWeb().getWebPage(url);
	const file = outputFilename ?? 'scrape.md';
	writeFileSync(file, markdown);
	const tokens = await countTokens(markdown);
	console.log(markdown);
	terminalLog(`Written ${tokens} tokens to ${file}`);
	process.exit(0);
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
