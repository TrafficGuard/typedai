import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { agentContextStorage, createContext } from '#agent/agentContextLocalStorage';
import { PublicWeb } from '#functions/web/web';
import { defaultLLMs } from '#llm/services/defaultLlms';

// npm run scrape <URL> <filename(optional)>

async function url2markdown(url: string) {
	if (!URL.canParse(url)) throw new Error('Invalid URL');
	console.log(`${url}\n`);
	agentContextStorage.enterWith(
		createContext({
			subtype: 'scrape',
			initialPrompt: '',
			agentName: '',
		}),
	);

	const markdown = await new PublicWeb().getWebPage(url);
	const file = process.argv[3] ?? 'scrape.md';
	writeFileSync(file, markdown);
	console.log(`Written to ${file}`);
}

if (!process.argv[2]) {
	console.error('Pass the URL to scrape as the argument');
	process.exit(1);
}

url2markdown(process.argv[2]).catch(console.error);
