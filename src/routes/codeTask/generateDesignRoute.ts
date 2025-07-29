import type { AppFastifyInstance } from '#app/applicationTypes';
import { CodeTaskServiceImpl } from '#codeTask/codeTaskServiceImpl';
import { sendErrorResponse, sendNotFound, sendServerError } from '#fastify/responses';
import { CODE_TASK_API } from '#shared/codeTask/codeTask.api';
import { currentUser } from '#user/userContext';
import { registerApiRoute } from '../routeUtils';

export async function generateDesignRoute(fastify: AppFastifyInstance): Promise<void> {
	const codeTaskService = new CodeTaskServiceImpl(fastify.codeTaskRepository);

	registerApiRoute(fastify, CODE_TASK_API.generateDesign, async (request, reply) => {
		const userId = currentUser().id;
		const { codeTaskId } = request.params;
		// The body (GenerateDesignDataApiSchema) contains 'instructions', as per shared/codeTask.schema.ts
		// The service method generateDetailedDesign takes 'variations'.
		// This is a mismatch. The old route used `request.body.variations`.
		// The current API definition `CODE_TASK_API.generateDesign` uses `GenerateDesignDataApiSchema` which has `instructions`.
		// The service method `generateDetailedDesign(userId: string, codeTaskId: string, variations = 1)`
		// For now, instructions from the request body will be logged and ignored by the service call.
		// The service method or API definition should be reconciled.
		const { instructions } = request.body; // As per CODE_TASK_API.generateDesign schema
		if (instructions) {
			fastify.log.warn(
				`Received 'instructions' for generateDesign API, but the current service method 'generateDetailedDesign' expects 'variations'. Instructions will be ignored. Service or API definition may need an update. Instructions: ${instructions}`,
			);
		}

		try {
			// Calling with default variations as 'variations' is not in the new API schema for this endpoint.
			// The 'instructions' from the body are not used by the current service method signature.
			await codeTaskService.generateDetailedDesign(userId, codeTaskId);
			return reply.sendJSON({ message: 'Design generation accepted and processing started.' });
		} catch (error: any) {
			fastify.log.error(error, `Error triggering design generation for codeTask ${codeTaskId}, user ${userId}`);
			if (error.message?.includes('not found')) {
				return sendNotFound(reply, `Code task with ID ${codeTaskId} not found`);
			}
			if (error.message?.includes('state')) {
				// HTTP 409 Conflict for state issues
				reply.code(409);
				return reply.send({ error: error.message || 'Cannot generate design in current state' });
			}
			return sendServerError(reply, error.message || 'Failed to trigger design generation');
		}
	});
}
