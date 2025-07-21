import type { Static } from '@sinclair/typebox';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { summaryLLM } from '#llm/services/defaultLlms';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CHAT_API } from '#shared/chat/chat.api';
import type { ChatMarkdownRequestSchema, ChatMarkdownResponseModel } from '#shared/chat/chat.schema';
import { currentUser } from '#user/userContext';

export async function formatAsMarkdownRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CHAT_API.formatAsMarkdown, async (req, reply) => {
		currentUser();

		const { text } = req.body as Static<typeof ChatMarkdownRequestSchema>;

		const llmToUse = summaryLLM();
		if (!llmToUse.isConfigured()) {
			logger.error('Markdown formatting: summaryLLM is not configured.');
			return send(reply, 503, { error: 'Markdown formatting service is currently unavailable due to LLM configuration.' });
		}

		const prompt = `Please reformat the following text with appropriate Markdown tags. Your response should only contain the Markdown formatted text and nothing else. Do not include any preamble or explanation.
<text_to_format>
${text}
</text_to_format>`;

		try {
			const markdownText = await llmToUse.generateText(prompt, { id: 'markdown-format' });
			reply.sendJSON({ markdownText } as ChatMarkdownResponseModel);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			logger.error({ err: error, inputTextLength: text.length }, `Failed to format text as Markdown: ${errorMessage}`);
			send(reply, 500, { error: 'Failed to format text as Markdown.' });
		}
	});
}
