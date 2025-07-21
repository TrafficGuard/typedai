import type { AppFastifyInstance } from '#app/applicationTypes';
import { send } from '#fastify/index';
import { userToJwtPayload } from '#fastify/jwt';
import { logger } from '#o11y/logger';
import { registerApiRoute } from '#routes/routeUtils';
import { AUTH_API } from '#shared/auth/auth.api';

export async function signInRoute(fastify: AppFastifyInstance): Promise<void> {
	registerApiRoute(fastify, AUTH_API.signIn, async (req, reply) => {
		try {
			logger.debug(`signin email:${req.body.email}`);
			const user = await fastify.userService.authenticateUser(req.body.email, req.body.password);
			const token = await reply.jwtSign(userToJwtPayload(user));
			logger.debug(`signin success user:${JSON.stringify(user)}`);
			send(reply, 200, {
				user,
				accessToken: token,
			});
		} catch (error) {
			logger.info(error);
			// Return 400 and not 401 so the auth-interceptor doesn't catch it
			send(reply, 400, { error: error.message });
		}
	});
}
