import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';

export async function createCodeReviewRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, CODE_REVIEW_API.create, async (request, reply) => {
		const config = request.body;
		try {
			const id = await fastify.codeReviewService.createCodeReviewConfig(config);
			reply.sendJSON({ message: `Config created with ID: ${id}` });
		} catch (error) {
			logger.error(error, 'Error creating code review config');
			send(reply, 500, '', { message: 'Internal Server Error' });
		}
	});
}
