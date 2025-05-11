import { Type } from '@sinclair/typebox';
// FastifyReply import might not be needed if type inference for `reply` is sufficient
// import type { FastifyReply } from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { sendBadRequest } from '#fastify/responses'; // Import sendBadRequest
import { logger } from '#o11y/logger';
import type { User, UserProfile } from '#shared/model/user.model'; // Added UserProfile
import { currentUser } from '#user/userContext';
import { API } from '#shared/api-definitions';

export async function profileRoute(fastify: AppFastifyInstance) {
	fastify.get(API.profile.view.pathTemplate, async (req, reply) => {
		const user: User = currentUser();

		// Transform User to UserProfile to match the API response schema
		const userProfileData: UserProfile = {
			id: user.id,
			email: user.email,
			enabled: user.enabled,
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt,
			hilBudget: user.hilBudget,
			hilCount: user.hilCount,
			llmConfig: user.llmConfig,
			chat: user.chat,
			functionConfig: user.functionConfig,
		};

		// Use the decorated reply.sendJSON with the schema type
		reply.sendJSON<typeof API.profile.view.schema.response[200]>(userProfileData);
	});

	fastify.post(
		API.profile.update.pathTemplate,
		{
			schema: API.profile.update.schema,
		},
		async (req, reply) => {
			const userUpdates = req.body.user;
			logger.info('Profile update');
			logger.info(userUpdates); // Be cautious logging entire userUpdates if it could contain sensitive info in future
			try {
				const updatedUser: User = await fastify.userService.updateUser(userUpdates);

				// Transform User to UserProfile to match the API response schema
				const userProfileData: UserProfile = {
					id: updatedUser.id,
					email: updatedUser.email,
					enabled: updatedUser.enabled,
					createdAt: updatedUser.createdAt,
					lastLoginAt: updatedUser.lastLoginAt,
					hilBudget: updatedUser.hilBudget,
					hilCount: updatedUser.hilCount,
					llmConfig: updatedUser.llmConfig,
					chat: updatedUser.chat,
					functionConfig: updatedUser.functionConfig,
				};
				// Use the decorated reply.sendJSON with the schema type
				reply.sendJSON<typeof API.profile.update.schema.response[200]>(userProfileData);
			} catch (error) {
				// Use sendBadRequest for typed error responses
				sendBadRequest(reply, error instanceof Error ? error.message : 'Invalid profile update data');
			}
		},
	);
}
