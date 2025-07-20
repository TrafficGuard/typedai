import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';

export async function updateCodeReviewRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CODE_REVIEW_API.update, async (request, reply) => {
		const { id } = request.params;
		const config = request.body;
		try {
			await fastify.codeReviewService.updateCodeReviewConfig(id, config);
			reply.sendJSON({ message: 'Config updated successfully' });
		} catch (error) {
			logger.error(error, 'Error updating code review config');
			send(reply, 500, '', { message: 'Internal Server Error' });
		}
	});
}
