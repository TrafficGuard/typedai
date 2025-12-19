import type { AppFastifyInstance } from '#app/applicationTypes';
import { cancelDebateRoute } from './cancelDebateRoute';
import { getDebateRoute } from './getDebateRoute';
import { getResultRoute } from './getResultRoute';
import { listDebatesRoute } from './listDebatesRoute';
import { pauseDebateRoute } from './pauseDebateRoute';
import { resumeDebateRoute } from './resumeDebateRoute';
import { startDebateRoute } from './startDebateRoute';
import { streamDebateRoute } from './streamDebateRoute';
import { submitHitlRoute } from './submitHitlRoute';

export async function debateRoutes(fastify: AppFastifyInstance): Promise<void> {
	await startDebateRoute(fastify);
	await getDebateRoute(fastify);
	await listDebatesRoute(fastify);
	await pauseDebateRoute(fastify);
	await resumeDebateRoute(fastify);
	await cancelDebateRoute(fastify);
	await submitHitlRoute(fastify);
	await getResultRoute(fastify);
	await streamDebateRoute(fastify);
}
