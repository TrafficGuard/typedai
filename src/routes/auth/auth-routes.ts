import type { AppFastifyInstance } from '#app/applicationTypes';
import { signInRoute } from './signIn';
import { signUpRoute } from './signUp';

const AUTH_ERRORS = {
	INVALID_CREDENTIALS: 'Invalid credentials',
	USER_EXISTS: 'User already exists',
};

const basePath = '/api/auth';

export async function authRoutes(fastify: AppFastifyInstance) {
	// Authentication routes
	await signInRoute(fastify);
	await signUpRoute(fastify);
}
