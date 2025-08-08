import '#fastify/trace-init/trace-init';
import { appContext, initApplicationContext } from '#app/applicationContext';

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import fastify, { FastifyRequest, FastifyReply } from 'fastify';

import { Claude3_5_Haiku_Vertex, Claude4_1_Opus_Vertex, Claude4_Sonnet_Vertex } from '#llm/services/anthropic-vertex';
import type { AssistantContentExt, LlmMessage, TextPartExt } from '#shared/llm/llm.model';

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 8080);
const LOG_FILE = process.env.LLM_PROXY_LOG ?? 'llm-proxy.log';

/**
 * Anthropic ↔ internal model name mapping
 */
function pickLLM(modelName: string) {
	if (modelName.includes('haiku')) return Claude3_5_Haiku_Vertex();
	if (modelName.includes('sonnet')) return Claude4_Sonnet_Vertex();
	if (modelName.includes('opus')) return Claude4_1_Opus_Vertex();
	return undefined;
}

/**
 * Convert an Anthropic input message to our local LlmMessage representation.
 */
function toLlmMessage(anthropicMsg: any): LlmMessage {
	const role = anthropicMsg.role === 'user' ? 'user' : 'assistant';
	const content = Array.isArray(anthropicMsg.content)
		? anthropicMsg.content
				.filter((b: any) => b.type === 'text')
				.map(
					(b: any): TextPartExt => ({
						type: 'text',
						text: b.text,
					}),
				)
		: (anthropicMsg.content as string);

	return { role, content };
}

/**
 * Convert your internal Assistant answer back to Anthropic wire format.
 */
function fromAssistantContent(content: AssistantContentExt) {
	if (typeof content === 'string') {
		return [{ type: 'text', text: content }];
	}
	return content.filter((p) => p.type === 'text').map((p) => ({ type: 'text', text: (p as TextPartExt).text }));
}

/* ------------------------------------------------------------- log to file */
async function persistLog(entry: unknown) {
	await fs.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

/* -------------------------------------------------------------------- app */
const app = fastify({
	bodyLimit: 4 * 1024 * 1024, // 4mb, equivalent to express.json({ limit: '4mb' })
});

app.post('/v1/messages', async (request: FastifyRequest, reply: FastifyReply) => {
	const started = Date.now();
	const reqId = randomUUID();

	/* --------------------------------------------------------------- validate */
	const { model, messages, max_tokens } = (request.body as any) ?? {};
	if (!model || !messages) {
		return reply.code(400).send({
			error: { message: '`model` and `messages` are required', type: 'proxy_error' },
			type: 'error',
		});
	}

	const llm = pickLLM(model);
	if (!llm) {
		return reply.code(400).send({
			error: { message: `Unsupported model ${model}`, type: 'proxy_error' },
			type: 'error',
		});
	}

	/* -------------------------------------- convert request → internal types */
	const llmMsgs: LlmMessage[] = messages.map(toLlmMessage);

	/* -------------------------------------------------------- call the model */
	try {
		const assistantMsg = await llm.generateMessage(llmMsgs, {
			id: reqId,
			maxOutputTokens: max_tokens,
		});

		/* --------------------------- produce Anthropic-style success response */
		const stats = assistantMsg.stats!;
		const body = {
			id: `msg_${reqId}`,
			type: 'message',
			role: 'assistant',
			model,
			content: fromAssistantContent(assistantMsg.content as AssistantContentExt),
			stop_reason: 'end_turn',
			stop_sequence: null,
			usage: {
				input_tokens: stats.inputTokens,
				output_tokens: stats.outputTokens,
			},
		};

		reply.send(body);

		/* -------------------------------------------- persist audit log line */
		await persistLog({
			id: reqId,
			requestAt: started,
			duration: Date.now() - started,
			model,
			inputTokens: stats.inputTokens,
			outputTokens: stats.outputTokens,
			cost: stats.cost,
			requestBody: request.body,
			responseBody: body,
		});
	} catch (err: any) {
		/* ----------------------------- model error → Anthropic-style 500 JSON */
		const errorBody = {
			error: { message: err.message ?? 'LLM error', type: 'proxy_error' },
			type: 'error',
		};
		reply.code(500).send(errorBody);

		await persistLog({
			id: reqId,
			requestAt: started,
			duration: Date.now() - started,
			model,
			error: err.stack ?? String(err),
			requestBody: request.body,
		});
	}
});

/* ------------------------------------------------------------ start server */
const start = async () => {
	await initApplicationContext();
	try {
		await app.listen({ port: PROXY_PORT });
		console.log(`LLM proxy listening on http://localhost:${PROXY_PORT}`);
	} catch (err) {
		console.error(err);
		process.exit(1);
	}
};

start();
