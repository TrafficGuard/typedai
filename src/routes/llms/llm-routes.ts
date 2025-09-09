import type { AppFastifyInstance } from '#app/applicationTypes';
import { getLLM, llmTypes } from '#llm/llmFactory';
import { logger } from '#o11y/logger';
import { LLMS_API } from '#shared/llm/llm.api';

export async function llmRoutes(fastify: AppFastifyInstance): Promise<void> {
	// Returns the LLMs which are configured for the current user
	fastify.route({
		method: LLMS_API.list.method,
		url: LLMS_API.list.pathTemplate,
		schema: LLMS_API.list.schema,
		handler: async (req, reply) => {
			const configuredLLMs = llmTypes()
				.map((llm) => {
					try {
						return getLLM(llm.id);
					} catch (e: any) {
						logger.warn((e as Error).message);
						return null;
					}
				})
				.filter((llm) => llm?.isConfigured() && llm?.getService() !== 'mock')
				.map((llm) => ({ id: llm!.getId(), name: llm!.getDisplayName(), isConfigured: true }));
			return { data: configuredLLMs };
		},
	});
}
