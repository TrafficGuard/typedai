import type { AppFastifyInstance } from '#app/applicationTypes';
import { AGENT_API } from '#shared/agent/agent.api';
import { functionRegistry } from '../../functionRegistry';
import { registerApiRoute } from '../routeUtils';

export async function getAvailableFunctionsRoute(fastify: AppFastifyInstance) {
	registerApiRoute(fastify, AGENT_API.getAvailableFunctions, async (req, reply) => {
		const functionNames = functionRegistry().map((t) => t.name);
		reply.sendJSON(functionNames);
	});
}
