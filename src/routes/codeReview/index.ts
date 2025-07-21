import type { AppFastifyInstance } from '#app/applicationTypes';
import { createCodeReviewRoute } from './createCodeReviewRoute';
import { deleteCodeReviewRoute } from './deleteCodeReviewRoute';
import { getCodeReviewByIdRoute } from './getCodeReviewByIdRoute';
import { listCodeReviewsRoute } from './listCodeReviewsRoute';
import { updateCodeReviewRoute } from './updateCodeReviewRoute';

export async function codeReviewRoutes(fastify: AppFastifyInstance): Promise<void> {
	await listCodeReviewsRoute(fastify);
	await getCodeReviewByIdRoute(fastify);
	await createCodeReviewRoute(fastify);
	await updateCodeReviewRoute(fastify);
	await deleteCodeReviewRoute(fastify);
}
