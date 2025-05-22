import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { TSchema } from '@sinclair/typebox';
import type {
	ContextConfigDefault,
	FastifyReply as FastifyReplyBase,
	FastifyRequest as FastifyRequestBase,
	FastifySchema,
	RawReplyDefaultExpression,
	RawRequestDefaultExpression,
	RawServerDefault,
	RouteGenericInterface,
} from 'fastify';
import type { AppFastifyInstance } from '#app/applicationTypes';
import type { RouteDefinition, RouteSchemaConfig } from '#shared/api-definitions';

// Helper type to construct RouteGenericInterface from a FastifySchema
type RouteGenericFromSchema<Schema extends FastifySchema> = RouteGenericInterface & {
	Body: Schema extends { body: infer B } ? B : unknown;
	Querystring: Schema extends { querystring: infer Q } ? Q : unknown;
	Params: Schema extends { params: infer P } ? P : unknown;
	Headers: Schema extends { headers: infer H } ? H : unknown;
	Reply: Schema extends { response: infer R } ? R : unknown; // This represents the schema for all responses
};

export async function registerRoute<
	// Generics for the RouteDefinition structure
	TPath extends string,
	TMethod extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
	TPathParamsSchema extends TSchema | undefined,
	TQuerySchema extends TSchema | undefined,
	TBodySchema extends TSchema | undefined,
	TResponseSchemasMap extends Record<number, TSchema> | undefined,
	TSuccessResponsePayload, // The type for the success payload for reply.sendJSON()
>(
	fastify: AppFastifyInstance,
	route: RouteDefinition<TPath, TMethod, TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>,
	handler: (
		req: FastifyRequestBase<
			RouteGenericFromSchema<RouteSchemaConfig<TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>>,
			RawServerDefault,
			RawRequestDefaultExpression<RawServerDefault>,
			RouteSchemaConfig<TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>, // SchemaCompiler for request
			TypeBoxTypeProvider
		>,
		reply: FastifyReplyBase<
			RawServerDefault,
			RawRequestDefaultExpression<RawServerDefault>,
			RawReplyDefaultExpression<RawServerDefault>,
			RouteGenericFromSchema<RouteSchemaConfig<TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>>, // RouteGenericInterface for reply
			ContextConfigDefault,
			RouteSchemaConfig<TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>, // SchemaCompiler for reply
			TypeBoxTypeProvider,
			TSuccessResponsePayload // Explicitly types payload for reply.sendJSON()
		>,
	) => Promise<void>,
) {
	// The schema object to pass to Fastify's options.
	// Its type is RouteSchemaConfig<...> which is compatible with Fastify's expected schema type.
	const fastifySchemaOptions = { schema: route.schema };

	if (route.method === 'GET') {
		fastify.get(
			route.pathTemplate,
			fastifySchemaOptions,
			handler as any, // Add type assertion
		);
	} else if (route.method === 'POST') {
		fastify.post(
			route.pathTemplate,
			fastifySchemaOptions,
			handler as any, // Add type assertion
		);
	} else if (route.method === 'PUT') {
		fastify.put(
			route.pathTemplate,
			fastifySchemaOptions,
			handler as any, // Add type assertion
		);
	} else if (route.method === 'PATCH') {
		fastify.patch(
			route.pathTemplate,
			fastifySchemaOptions,
			handler as any, // Add type assertion
		);
	} else if (route.method === 'DELETE') {
		fastify.delete(route.pathTemplate, fastifySchemaOptions, handler as any);
	} else {
		// This will cause a type error if TMethod isn't exhausted by the checks above.
		const _exhaustiveCheck: never = route.method;
	}
}
