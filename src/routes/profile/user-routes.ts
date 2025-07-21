import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { USER_API } from '#shared/user/user.api';
import type { UserProfileUpdate } from '#shared/user/user.model';
import { viewProfileRoute } from './view';

export async function userRoutes(fastify: AppFastifyInstance): Promise<void> {
	await viewProfileRoute(fastify);

	fastify.post(
		USER_API.update.pathTemplate,
		{
			schema: USER_API.update.schema,
		},
		async (req, reply) => {
			const userProfile: UserProfileUpdate = req.body;
			logger.info(userProfile, 'Profile update');
			try {
				await fastify.userService.updateUser(userProfile);
				reply.code(204).send();
			} catch (error) {
				sendBadRequest(reply, error instanceof Error ? error.message : 'Invalid profile update data');
			}
		},
	);
}
