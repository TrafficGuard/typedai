import type {AppFastifyInstance} from "#app/applicationTypes";
import {RouteDefinition} from "#shared/api-definitions";

export async function registerRoute(fastify: AppFastifyInstance, route: RouteDefinition<any, any>, handler:(req, resp) => Promise<void>) {
    if(route.method === 'GET') {
        fastify.get(
            route.pathTemplate,
            {schema: route.schema},
            handler)
    } else if(route.method === 'POST') {
        fastify.post(
            route.pathTemplate,
            {schema: route.schema},
            handler)
    } else if(route.method === 'PATCH') {
        fastify.patch(
            route.pathTemplate,
            {schema: route.schema},
            handler)
    } else if(route.method === 'DELETE') {
        fastify.delete(
            route.pathTemplate,
            {schema: route.schema},
            handler)
    } else {
        throw new Error(`Unsupported method ${route.method}`);
    }
}
