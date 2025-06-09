import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { userToJwtPayload } from '#fastify/jwt';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { AUTH_API } from '#shared/auth/auth.api';

export async function signUpRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, AUTH_API.signUp, async (req, reply) => {
		try {
			const user = await fastify.userService.createUserWithPassword(req.body.email, req.body.password);
			const token = await reply.jwtSign(userToJwtPayload(user));

			send(reply, 200, {
				user,
				accessToken: token,
			});
		} catch (error) {
			logger.info(error);
			send(reply, 400, { error: error.message });
		}
	});
}
