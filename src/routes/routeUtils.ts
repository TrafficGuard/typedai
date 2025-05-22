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
    TPath extends string,
    TSchema extends FastifySchema,
    TSuccessResponsePayload
>(
    fastify: AppFastifyInstance,
    // RouteDefinition is assumed to take TPath and TSuccessResponsePayload as generics.
    // The route object must also have a `schema` property of type TSchema and a `method`.
    route: RouteDefinition<TPath, TSuccessResponsePayload> & { schema: TSchema; method: 'GET' | 'POST' | 'PATCH' | 'DELETE' },
    handler: (
        req: FastifyRequestBase<
            RouteGenericFromSchema<TSchema>,
            RawServerDefault,
            RawRequestDefaultExpression<RawServerDefault>,
            TSchema, // SchemaCompiler for request
            TypeBoxTypeProvider
        >,
        reply: FastifyReplyBase<
            RawServerDefault,
            RawRequestDefaultExpression<RawServerDefault>,
            RawReplyDefaultExpression<RawServerDefault>,
            RouteGenericFromSchema<TSchema>, // RouteGenericInterface for reply
            ContextConfigDefault,
            TSchema, // SchemaCompiler for reply
            TypeBoxTypeProvider,
            TSuccessResponsePayload // Explicitly types payload for reply.sendJSON()
        >
    ) => Promise<void>
) {
    if(route.method === 'GET') {
        fastify.get(
            route.pathTemplate, // This is now of type TPath (string)
            {schema: route.schema}, // route.schema is of type TSchema
            handler as any // Add type assertion
        );
    } else if(route.method === 'POST') {
        fastify.post(
            route.pathTemplate, // This is now of type TPath (string)
            {schema: route.schema},
            handler as any // Add type assertion
        );
    } else if(route.method === 'PATCH') {
        fastify.patch(
            route.pathTemplate, // This is now of type TPath (string)
            {schema: route.schema},
            handler as any // Add type assertion
        );
    } else if(route.method === 'DELETE') {
        fastify.delete(
            route.pathTemplate, // This is now of type TPath (string)
            {schema: route.schema},
            handler as any // Add type assertion
        );
    } else {
        throw new Error(`Unsupported method ${route.method}`);
    }
}
