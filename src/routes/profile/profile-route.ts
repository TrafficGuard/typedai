import { Type } from '@sinclair/typebox';
import { FastifyReply } from 'fastify';
import { send } from '#fastify/index';
import { logger } from '#o11y/logger';
import { User } from '#user/user';
import { currentUser } from '#user/userService/userContext';
import { AppFastifyInstance } from '../../applicationTypes';

const basePath = '/api/profile';

export async function profileRoute(fastify: AppFastifyInstance) {
	fastify.get(`${basePath}/view`, async (req, reply) => {
		const user: User = currentUser();

		send(reply, 200, user);
	});

	fastify.post(
		`${basePath}/update`,
		{
			schema: {
				body: Type.Object({
					user: Type.Object({
						email: Type.Optional(Type.String()),
						chat: Type.Optional(
							Type.Object({
								temperature: Type.Optional(Type.Number()),
								topP: Type.Optional(Type.Number()),
								topK: Type.Optional(Type.Number()),
								presencePenalty: Type.Optional(Type.Number()),
								frequencyPenalty: Type.Optional(Type.Number()),
								enabledLLMs: Type.Optional(Type.Record(Type.String(), Type.Boolean())),
								defaultLLM: Type.Optional(Type.String()),
							}),
						),
					}),
				}),
			},
		},
		async (req, reply) => {
			const userUpdates = req.body.user;
			logger.info('Profile update');
			logger.info(userUpdates);
			try {
				const user = await fastify.userService.updateUser(userUpdates);
				send(reply as FastifyReply, 200, user);
			} catch (error) {
				send(reply as FastifyReply, 400, {
					error: error instanceof Error ? error.message : 'Invalid chat settings',
				});
			}
		},
	);
}
