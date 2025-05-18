import { appContext } from '#app/applicationContext';
import type { AppFastifyInstance } from '#app/applicationTypes';
import { type FastifyRoutes, initFastify } from '#fastify/fastifyApp';

export async function createTestFastify(routes?: FastifyRoutes): Promise<AppFastifyInstance> {
	// would want to clear any old applicationContext
	const applicationContext = appContext();
	const fastify = await initFastify({
		routes: routes ? [routes] : [],
		...applicationContext,
	});
	return fastify as AppFastifyInstance; // Cast to ensure the correct type is returned
}
