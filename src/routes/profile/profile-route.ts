import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { logger } from '#o11y/logger';
import type { User } from '#shared/model/user.model';
import { currentUser } from '#user/userContext';
import {sendJSON} from "#fastify/responses";

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
				sendJSON(reply, user);
			} catch (error) {
				send(reply as FastifyReply, 400, {
					error: error instanceof Error ? error.message : 'Invalid chat settings',
				});
			}
		},
	);
}
