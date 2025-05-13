import type { FastifyInstance } from 'fastify';
import { DEFAULT_HEALTHCHECK } from '#fastify/fastifyApp';
import { sendBadRequest } from './responses';

export interface RouteInterface {
	method: string | string[];
	version: string | string[];
	endpoint: string | string[];
}

export function loadOnRequestHooks(fastify: FastifyInstance) {
	fastify.addHook('onRequest', (request: any, reply: any, done: () => void) => {
		const routerMethod = request.routeOptions.method;
		const routerPath = request.routeOptions.url;
		if (!(routerMethod && routerPath)) {
			sendBadRequest(reply, 'The URL is incorrect');
			return;
		}

		request.custom = {};
		if (routerPath === DEFAULT_HEALTHCHECK) {
			request.custom.requestRoute = {
				method: routerMethod,
				version: '',
				endpoint: 'health-check',
			} as RouteInterface;
			done();
			return;
		}
		done();
	});
}
