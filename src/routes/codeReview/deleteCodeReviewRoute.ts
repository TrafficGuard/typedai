import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';

export async function deleteCodeReviewRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CODE_REVIEW_API.delete, async (request, reply) => {
		const { id } = request.params;
		try {
			await fastify.codeReviewService.deleteCodeReviewConfig(id);
			reply.sendJSON({ message: 'Config deleted successfully' });
		} catch (error) {
			logger.error(error, 'Error deleting code review config');
			send(reply, 500, '', { message: 'Internal Server Error' });
		}
	});
}
