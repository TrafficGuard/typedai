import type { FastifyInstance } from 'fastify';
import { appContext } from '#app/applicationContext';
import { initFastify } from '#fastify/fastifyApp';

export async function createTestFastify(): Promise<FastifyInstance> {
	// would want to clear any old applicationContext
	const applicationContext = appContext();
	const fastify = await initFastify({
		routes: [],
		...applicationContext,
	});
	return fastify;
}
