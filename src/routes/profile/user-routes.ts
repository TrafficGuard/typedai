import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/responses';
import { logger } from '#o11y/logger';
import { USER_API } from '#shared/api/user.api';
import type { User } from '#shared/model/user.model';
import type { UserProfile, UserProfileUpdate } from '#shared/schemas/user.api.schema';
import { currentUser } from '#user/userContext';

export async function userRoutes(fastify: AppFastifyInstance) {
	fastify.get(
		USER_API.view.pathTemplate,
		{
			schema: USER_API.view.schema,
		},
		async (req, reply) => {
			const user: User = currentUser();

			const userProfileData: UserProfile = {
				id: user.id,
				name: user.name,
				email: user.email,
				enabled: user.enabled,
				hilBudget: user.hilBudget,
				hilCount: user.hilCount,
				llmConfig: user.llmConfig,
				chat: user.chat,
				functionConfig: user.functionConfig,
			};

			reply.sendJSON(userProfileData);
		},
	);

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
			} catch (error) {
				sendBadRequest(reply, error instanceof Error ? error.message : 'Invalid profile update data');
			}
		},
	);
}
