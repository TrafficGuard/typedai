import '#fastify/trace-init/trace-init';

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { appContext, initApplicationContext } from '#app/applicationContext';
import { getLLM } from '#llm/llmFactory';
import { FastMediumLLM } from '#llm/multi-agent/fastMedium';
import { MAD_Balanced, MAD_Fast, MAD_SOTA } from '#llm/multi-agent/reasoning-debate';
import { Claude4_Opus_Vertex } from '#llm/services/anthropic-vertex';
import { defaultLLMs, summaryLLM } from '#llm/services/defaultLlms';
import { openAIo3 } from '#llm/services/openai';
import { perplexityDeepResearchLLM, perplexityLLM, perplexityReasoningProLLM } from '#llm/services/perplexity-llm';
import { logger } from '#o11y/logger';
import { getMarkdownFormatPrompt } from '#routes/chat/chatPromptUtils';
import { LLM, LlmMessage, UserContentExt, contentText, messageText, user } from '#shared/llm/llm.model';
import { currentUser } from '#user/userContext';
import { parseProcessArgs, saveAgentId } from './cli';

const LLM_CLI_ALIAS: Record<string, () => LLM> = {
	e: () => defaultLLMs().easy,
	m: () => defaultLLMs().medium,
	h: () => defaultLLMs().hard,
	x: () => defaultLLMs().xhard,
	fm: () => new FastMediumLLM(),
	o3: openAIo3,
	madb: MAD_Balanced,
	mads: MAD_SOTA,
	madf: MAD_Fast,
	opus: Claude4_Opus_Vertex,
	p1: perplexityLLM,
	p2: perplexityReasoningProLLM,
	p3: perplexityDeepResearchLLM,
};

async function main() {
	await initApplicationContext();

	const { initialPrompt: rawPrompt, resumeAgentId, flags } = parseProcessArgs();

	// ­Prompt fallback to file
	let prompt = rawPrompt.trim();
	if (!prompt && existsSync('src/cli/chat.prompt.md')) {
		prompt = readFileSync('src/cli/chat.prompt.md', 'utf-8');
	}

	// ­Model selection –  -l / --llm  (default medium)
	const llmAlias = (flags.l as string) ?? (flags.llm as string);
	let llm: LLM;
	try {
		llm = llmAlias ? (LLM_CLI_ALIAS[llmAlias]?.() ?? getLLM(llmAlias)) : defaultLLMs().medium;
	} catch {
		logger.warn(`Unknown llm alias/id '${llmAlias}', falling back to medium`);
		llm = defaultLLMs().medium;
	}

	// ­Optional Markdown re-format (-m flag present with no value)
	if (flags.m === true) {
		try {
			console.log('Formnatting prompt with markdown');
			const fmtPrompt = getMarkdownFormatPrompt(prompt);
			prompt = await defaultLLMs().medium.generateText(fmtPrompt, { id: 'CLI chat markdown format' });
		} catch (e) {
			logger.error(e, 'Markdown auto-format failed – continuing with original prompt');
		}
	}

	const chatService = appContext().chatService;

	// === resume OR create ===
	if (resumeAgentId) {
		const chat = await chatService.loadChat(resumeAgentId);

		if (prompt) chat.messages.push(user(prompt as UserContentExt));

		const replyMsg = await llm.generateMessage(chat.messages, { id: 'CLI chat' });
		chat.messages.push(replyMsg);
		chat.updatedAt = Date.now();

		await chatService.saveChat(chat);
		saveAgentId('chat', chat.id);

		const out = messageText(replyMsg);
		writeFileSync('src/cli/chat-out', out);
		console.log(out);
		console.log(`Open in UI: /chats/${chat.id}\nResume: ai chat -r=${chat.id}`);
		return;
	}

	// ­New chat
	let title = 'CLI chat';
	try {
		console.log('Generating title');
		const titleLLM = summaryLLM().isConfigured() ? summaryLLM() : defaultLLMs().easy;
		title = await titleLLM.generateText(`<message>\n${contentText(prompt)}\n</message>\nSummarise in ≤8 words. Only output the summary.`, { id: 'Chat-title' });
	} catch (e) {
		console.error(`Error generating title. ${e.message}`);
	}

	const chat = await chatService.saveChat({
		id: undefined as any,
		title,
		userId: currentUser().id,
		shareable: false,
		updatedAt: Date.now(),
		messages: [user(prompt as UserContentExt)],
		parentId: undefined,
		rootId: undefined,
	});

	const assistantMsg: LlmMessage = await llm.generateMessage(chat.messages, { id: 'CLI-chat' });
	chat.messages.push(assistantMsg);
	chat.updatedAt = Date.now();

	const saved = await chatService.saveChat(chat);
	saveAgentId('chat', saved.id);

	const out = messageText(assistantMsg);
	writeFileSync('src/cli/chat-out', out);
	console.log(out);
	console.log(`Open in UI: /chats/${saved.id}\nResume: ai chat -r=${saved.id}`);
}

main().catch(console.error);
