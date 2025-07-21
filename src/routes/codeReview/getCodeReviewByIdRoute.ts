import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';

export async function getCodeReviewByIdRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CODE_REVIEW_API.getById, async (request, reply) => {
		const { id } = request.params;
		try {
			const config = await fastify.codeReviewService.getCodeReviewConfig(id);
			if (config) {
				reply.sendJSON(config);
			} else {
				send(reply, 404, { message: 'Config not found' });
			}
		} catch (error) {
			logger.error(error, 'Error getting code review config');
			send(reply, 500, '', { message: 'Internal Server Error' });
		}
	});
}
