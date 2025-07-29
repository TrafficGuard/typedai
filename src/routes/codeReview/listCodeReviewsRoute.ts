import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';

export async function listCodeReviewsRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CODE_REVIEW_API.list, async (request, reply) => {
		try {
			const configs = await fastify.codeReviewService.listCodeReviewConfigs();
			reply.sendJSON(configs);
		} catch (error) {
			logger.error(error, 'Error listing code review configs');
			send(reply, 500, '', { message: 'Internal Server Error' });
		}
	});
}
