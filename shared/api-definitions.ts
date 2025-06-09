import type { TSchema } from '@sinclair/typebox';
import { ApiErrorResponseSchema } from './common.schema';

/**
 * Defines a server API route.
 */
export interface RouteDefinition<
	TPath extends string,
	TMethod extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
	TPathParamsSchema extends TSchema | undefined = undefined,
	TQuerySchema extends TSchema | undefined = undefined,
	TBodySchema extends TSchema | undefined = undefined,
	// biome-ignore lint:noBannedTypes
	TResponseSchemasMap extends Record<number, TSchema> = {},
> {
	method: TMethod;
	pathTemplate: TPath;
	buildPath: (params: PathParams<TPath>) => string;
	schema: RouteSchemaConfig<TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>;
}

/**
 * Creates a server API route definition with type safety.
 */
export function defineApiRoute<
	Path extends string,
	Method extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
	PathParamsSchema extends TSchema | undefined = undefined,
	QuerySchema extends TSchema | undefined = undefined,
	BodySchema extends TSchema | undefined = undefined,
	// biome-ignore lint:noBannedTypes
	ResponseSchemasMap extends Record<number, TSchema> = {},
>(
	method: Method,
	pathTemplate: Path,
	config?: { schema?: RouteSchemaConfig<PathParamsSchema, QuerySchema, BodySchema, ResponseSchemasMap> },
): RouteDefinition<Path, Method, PathParamsSchema, QuerySchema, BodySchema, ResponseSchemasMap> {
	const buildPath = (params: PathParams<Path>): string => {
		let resultPath: string = pathTemplate;
		if (params) {
			for (const key in params) {
				if (Object.prototype.hasOwnProperty.call(params, key)) {
					const paramValue = (params as any)[key];
					resultPath = resultPath.replace(`:${key}`, String(paramValue));
				}
			}
		}
		return resultPath;
	};

	const defaultErrorStatusCodes: number[] = [400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504];

	const routeSchema: RouteSchemaConfig<PathParamsSchema, QuerySchema, BodySchema, ResponseSchemasMap> = config?.schema ?? {};

	// Ensure routeSchema.response is initialized and is a mutable copy
	if (!routeSchema.response) {
		routeSchema.response = {} as NonNullable<ResponseSchemasMap>;
	} else {
		// Create a shallow copy to avoid modifying the original config object from the caller
		routeSchema.response = { ...routeSchema.response } as NonNullable<ResponseSchemasMap>;
	}

	// Add default error schemas if not already present
	// At this point, routeSchema.response is guaranteed to be an object (Record<number, TSchema>)
	for (const statusCode of defaultErrorStatusCodes) {
		if (!(statusCode in routeSchema.response)) {
			// The type assertion to Record<number, TSchema> is safe here.
			(routeSchema.response as Record<number, TSchema>)[statusCode] = ApiErrorResponseSchema;
		}
	}

	return {
		method,
		pathTemplate,
		buildPath,
		schema: routeSchema,
	};
}

// Path Parameter Helper
// Helper type for recursive path parameter extraction
type _RecursivePathParams<TPath extends string> = TPath extends `${string}:${infer Param}/${infer Rest}` // Matches "...:param/...rest"
	? { [K in Param]: string | number } & _RecursivePathParams<Rest>
	: TPath extends `${string}:${infer Param}` // Matches "...:param" (at the end)
		? { [K in Param]: string | number }
		: never; // No more parameters in this part of the string

export type PathParams<TPath extends string> =
	// If TPath is just 'string', allow any params (for dynamic routes not known at compile time)
	string extends TPath
		? Record<string, string | number>
		: // Otherwise, compute params. If the result of recursion is an empty object,
			// it means TPath had no params. In that case, the type should be Record<string, never>.
			// Otherwise, it's the computed params object.
			_RecursivePathParams<TPath> extends infer P
			? keyof P extends never // Check if P is an empty object {}
				? Record<string, never> // Path has no parameters
				: P // Path has parameters
			: Record<string, never>; // Should not be reached (fallback)

// Interface for the schema object within RouteDefinition
// Its properties (params, querystring, body, response) remain optional and match the FastifySchema for easy assignment.
export interface RouteSchemaConfig<
	PathParamsSchema extends TSchema | undefined,
	QuerySchema extends TSchema | undefined,
	BodySchema extends TSchema | undefined,
	ResponseSchemasMap extends Record<number, TSchema> | undefined,
> {
	params?: PathParamsSchema; // Renamed 'path' to 'params'
	querystring?: QuerySchema;
	body?: BodySchema;
	response?: ResponseSchemasMap;
}
/* The Fastify interface we want to follow the structure of so we can directly assign our RouteSchemaConfig
export interface FastifySchema {
	body?: unknown;
	querystring?: unknown;
	params?: unknown;
	headers?: unknown;
	response?: unknown;
}
*/
