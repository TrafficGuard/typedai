import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import { appContext } from '#app/applicationContext';
import { send, sendSuccess } from '#fastify/responses';
import { logger } from '#o11y/logger';

import type { CodeReviewConfig } from '#shared/model/codeReview.model';

export async function codeReviewRoutes(fastify: FastifyInstance) {
	fastify.get('/api/code-review-configs', async (request, reply) => {
		try {
			const configs = await appContext().codeReviewService.listCodeReviewConfigs();
			send(reply, 200, configs);
		} catch (error) {
			logger.error(error, 'Error listing code review configs');
			send(reply, 500, '', { message: 'Internal Server Error' });
		}
	});

	fastify.get(
		'/api/code-review-configs/:id',
		{
			schema: {
				params: Type.Object({
					id: Type.String(),
				}),
			},
		},
		async (request, reply) => {
			const { id } = request.params as { id: string };
			try {
				const config = await appContext().codeReviewService.getCodeReviewConfig(id);
				if (config) {
					send(reply, 200, config);
				} else {
					send(reply, 404, '', { message: 'Config not found' });
				}
			} catch (error) {
				logger.error(error, 'Error getting code review config');
				send(reply, 500, '', { message: 'Internal Server Error' });
			}
		},
	);

	fastify.post(
		'/api/code-review-configs',
		{
			schema: {
				body: Type.Object({
					description: Type.String(),
					fileExtensions: Type.Object({
						include: Type.Array(Type.String()),
					}),
					requires: Type.Object({
						text: Type.Array(Type.String()),
					}),
					tags: Type.Array(Type.String()),
					projectPaths: Type.Array(Type.String()),
					examples: Type.Array(
						Type.Object({
							code: Type.String(),
							reviewComment: Type.String(),
						}),
					),
				}),
			},
		},
		async (request, reply) => {
			const config = request.body as Omit<CodeReviewConfig, 'id'>;
			try {
				const id = await appContext().codeReviewService.createCodeReviewConfig(config);
				sendSuccess(reply, `Config created with ID: ${id}`);
			} catch (error) {
				logger.error(error, 'Error creating code review config');
				send(reply, 500, '', { message: 'Internal Server Error' });
			}
		},
	);

	fastify.put(
		'/api/code-review-configs/:id',
		{
			schema: {
				params: Type.Object({
					id: Type.String(),
				}),
				body: Type.Partial(
					Type.Object({
						description: Type.String(),
						file_extensions: Type.Object({
							include: Type.Array(Type.String()),
						}),
						requires: Type.Object({
							text: Type.Array(Type.String()),
						}),
						examples: Type.Array(
							Type.Object({
								code: Type.String(),
								review_comment: Type.String(),
							}),
						),
					}),
				),
			},
		},
		async (request, reply) => {
			const { id } = request.params as { id: string };
			const config = request.body as Partial<CodeReviewConfig>;
			try {
				await appContext().codeReviewService.updateCodeReviewConfig(id, config);
				sendSuccess(reply, 'Config updated successfully');
			} catch (error) {
				logger.error(error, 'Error updating code review config');
				send(reply, 500, '', { message: 'Internal Server Error' });
			}
		},
	);

	fastify.delete(
		'/api/code-review-configs/:id',
		{
			schema: {
				params: Type.Object({
					id: Type.String(),
				}),
			},
		},
		async (request, reply) => {
			const { id } = request.params as { id: string };
			try {
				await appContext().codeReviewService.deleteCodeReviewConfig(id);
				sendSuccess(reply, 'Config deleted successfully');
			} catch (error) {
				logger.error(error, 'Error deleting code review config');
				send(reply, 500, '', { message: 'Internal Server Error' });
			}
		},
	);
}
