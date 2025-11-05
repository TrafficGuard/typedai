import '#fastify/trace-init/trace-init'; // leave an empty line next so this doesn't get sorted from the first line

import { writeFileSync } from 'node:fs';
import { appContext, initApplicationContext, initInMemoryApplicationContext } from '#app/applicationContext';
import { ReasonerDebateLLM } from '#llm/multi-agent/reasoning-debate';
import { defaultLLMs } from '#llm/services/defaultLlms';
import { countTokens } from '#llm/tokens';
import { LLM, LlmMessage, ThinkingLevel, messageSources, messageText, system, user } from '#shared/llm/llm.model';
import { beep } from '#utils/beep';
import { parseProcessArgs } from './cli';
import { LLM_CLI_ALIAS } from './llmAliases';
import { parsePromptWithImages } from './promptParser';
import { terminalLog } from './terminal';

// Usage:
// ai gen -s="system prompt"  'input prompt'

async function main() {
	const { initialPrompt: rawPrompt, llmId, flags } = parseProcessArgs();
	const { textPrompt, userContent } = await parsePromptWithImages(rawPrompt);

	// -s save to database
	if (flags.s) await initApplicationContext();
	else initInMemoryApplicationContext();
	await appContext().init?.();

	let llm: LLM = defaultLLMs().medium;
	terminalLog('PROMPT:');
	terminalLog(rawPrompt);
	if (llmId) {
		if (!LLM_CLI_ALIAS[llmId]) {
			console.error(`LLM alias ${llmId} not found. Valid aliases are ${Object.keys(LLM_CLI_ALIAS).join(', ')}`);
			process.exit(1);
		}
		llm = LLM_CLI_ALIAS[llmId]();
	}

	// Count tokens of the text part only for display purposes
	const tokens = await countTokens(textPrompt);
	terminalLog(`Generating with ${llm.getId()}. Input ${tokens} text tokens\n`);
	const start = Date.now();
	// Pass the full UserContent (text + images) as a message array
	let thinking: ThinkingLevel = 'high';
	if (llm instanceof ReasonerDebateLLM) thinking = 'low';

	const messages: LlmMessage[] = [];
	if (flags.s) messages.push(system(textPrompt));
	messages.push(user(userContent));

	const message = await llm.generateMessage(messages, { id: 'CLI-gen', thinking });

	let text = messageText(message);

	const sources = messageSources(message);
	if (sources.length > 0) {
		text += '\n\nSources:\n';
		for (const source of sources) {
			switch (source.sourceType) {
				case 'url':
					text += `${source.url}\n`;
					break;
				case 'document':
					text += `${source.filename}\n`;
					break;
			}
		}
	}

	console.log(text);

	const duration = Date.now() - start;

	writeFileSync('src/cli/gen-out', text);

	if (flags.p) {
		try {
			const clipboardy = (await import('clipboardy')).default;
			await clipboardy.write(text);
			terminalLog('\nCopied output to clipboard.');
		} catch (error) {
			console.error('\nFailed to copy to clipboard. Is `clipboardy` installed? `npm i clipboardy`');
			console.error(error);
		}
	}

	terminalLog(
		`\nStats: ${llm.getId()} - Input: ${message.stats?.inputTokens}. Output: ${message.stats?.outputTokens}. Cost: \$${message.stats?.cost?.toFixed(3)}. Duration: ${(duration / 1000).toFixed(0)} seconds`,
	);
	terminalLog('Wrote output to src/cli/gen-out');
	beep();
}

main().catch(console.error);
