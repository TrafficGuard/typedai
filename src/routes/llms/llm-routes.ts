import { send } from '#fastify/index';
import { getLLM, llmTypes } from '#llm/llmFactory';
import { logger } from '#o11y/logger';
import { AppFastifyInstance } from '../../applicationTypes';

const basePath = '/api/llms';

export async function llmRoutes(fastify: AppFastifyInstance) {
	// Returns the LLMs which are configured for the current user
	fastify.get(`${basePath}/list`, async (req, reply) => {
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
			.map((llm) => ({ id: llm.getId(), name: llm.getDisplayName(), isConfigured: true }));
		send(reply, 200, configuredLLMs);
	});
}
