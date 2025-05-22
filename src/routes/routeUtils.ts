import type { AppFastifyInstance } from "#app/applicationTypes";
import type { RouteDefinition } from "#shared/api-definitions"; // Ensure this is RouteDefinition<Schema, SuccessPayload>
import type {
    FastifyRequest as FastifyRequestBase,
    FastifyReply as FastifyReplyBase,
    FastifySchema,
    RouteGenericInterface,
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    ContextConfigDefault
} from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// Helper type to construct RouteGenericInterface from a FastifySchema
type RouteGenericFromSchema<Schema extends FastifySchema> = RouteGenericInterface & {
    Body: Schema extends { body: infer B } ? B : unknown;
    Querystring: Schema extends { querystring: infer Q } ? Q : unknown;
    Params: Schema extends { params: infer P } ? P : unknown;
    Headers: Schema extends { headers: infer H } ? H : unknown;
    Reply: Schema extends { response: infer R } ? R : unknown; // This represents the schema for all responses
};


export async function registerRoute<
    Schema extends FastifySchema,
    SuccessResponsePayload
>(
    fastify: AppFastifyInstance,
    route: RouteDefinition<Schema, SuccessResponsePayload>,
    handler: (
        req: FastifyRequestBase<
            RouteGenericFromSchema<Schema>,
            RawServerDefault,
            RawRequestDefaultExpression<RawServerDefault>,
            Schema, // SchemaCompiler
            TypeBoxTypeProvider
        >,
        reply: FastifyReplyBase<
            RawServerDefault,
            RawRequestDefaultExpression<RawServerDefault>,
            RawReplyDefaultExpression<RawServerDefault>,
            RouteGenericFromSchema<Schema>, // RouteGenericInterface
            ContextConfigDefault,
            Schema, // SchemaCompiler
            TypeBoxTypeProvider,
            SuccessResponsePayload // Explicitly types payload for reply.sendJSON() for success responses
        >
    ) => Promise<void>
) {
    if(route.method === 'GET') {
        fastify.get(
            route.pathTemplate,
            {schema: route.schema},
            handler as any // Add type assertion
        );
    } else if(route.method === 'POST') {
        fastify.post(
            route.pathTemplate,
            {schema: route.schema},
            handler as any // Add type assertion
        );
    } else if(route.method === 'PATCH') {
        fastify.patch(
            route.pathTemplate,
            {schema: route.schema},
            handler as any // Add type assertion
        );
    } else if(route.method === 'DELETE') {
        fastify.delete(
            route.pathTemplate,
            {schema: route.schema},
            handler as any // Add type assertion
        );
    } else {
        throw new Error(`Unsupported method ${route.method}`);
    }
}
