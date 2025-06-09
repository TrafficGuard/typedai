import type { AppFastifyInstance } from '#app/applicationTypes';
import { signInRoute } from './signIn';
import { signUpRoute } from './signUp';

export async function authRoutes(fastify: AppFastifyInstance) {
	await signInRoute(fastify);
	await signUpRoute(fastify);
}
