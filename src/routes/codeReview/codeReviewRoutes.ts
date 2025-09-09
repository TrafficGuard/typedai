import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { CODE_REVIEW_API } from '#shared/codeReview/codeReview.api';

export async function codeReviewRoutes(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, CODE_REVIEW_API.list, async (request, reply) => {
		try {
			const configs = await fastify.codeReviewService.listCodeReviewConfigs();
			reply.sendJSON(configs);
		} catch (error) {
			logger.error(error, 'Error listing code review configs');
			send(reply, 500, '', { message: 'Internal Server Error' });
		}
	});

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

	registerApiRoute(fastify, CODE_REVIEW_API.update, async (request, reply) => {
		const { id } = request.params; // Removed explicit cast
		const config = request.body;
		try {
			await fastify.codeReviewService.updateCodeReviewConfig(id, config);
			reply.sendJSON({ message: 'Config updated successfully' });
		} catch (error) {
			logger.error(error, 'Error updating code review config');
			send(reply, 500, '', { message: 'Internal Server Error' });
		}
	});

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
