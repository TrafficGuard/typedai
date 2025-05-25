import { appContext } from '#app/applicationContext';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { type FastifyRoutes, initFastify } from '#fastify/fastifyApp';

export async function createTestFastify(routes?: FastifyRoutes): Promise<AppFastifyInstance> {
	// would want to clear any old applicationContext
	const applicationContext = appContext();
	const fastify = await initFastify({
		routes: routes ? [routes] : [],
		...applicationContext,
		port: 3003,
	});
	return fastify as AppFastifyInstance;
}
