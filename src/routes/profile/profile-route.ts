import { Type } from '@sinclair/typebox';
import type { FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { logger } from '#o11y/logger';
import type { User } from '#shared/model/user.model';
import { currentUser } from '#user/userContext';
import {sendJSON} from "#fastify/responses";
import { API } from '#shared/api-definitions';

export async function profileRoute(fastify: AppFastifyInstance) {
	fastify.get(API.profile.view.pathTemplate, async (req, reply) => {
		const user: User = currentUser();

		send(reply, 200, user);
	});

	fastify.post(
		API.profile.update.pathTemplate,
		{
			schema: {
				body: API.profile.update.schemas.body,
			},
		},
		async (req, reply) => {
			const userUpdates = (req.body as any).user;
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
