import { type TSchema } from '@sinclair/typebox';

/**
 * Defines a server API route.
 */
export interface RouteDefinition<
    TPath extends string, TMethod extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    TPathParamsSchema extends TSchema | undefined = undefined,
    TQuerySchema extends TSchema | undefined = undefined,
    TBodySchema extends TSchema | undefined = undefined,
    TResponseSchemasMap extends Record<number, TSchema> | undefined = undefined
> {
    method: TMethod;
    pathTemplate: TPath;
    buildPath: (params: PathParams<TPath>) => string;
    schema: RouteSchemaConfig<TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>;
}

/**
 * Creates a server API route definition with type safety.
 */
export function defineRoute<
    Path extends string, Method extends 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    PathParamsSchema extends TSchema | undefined = undefined,
    QuerySchema extends TSchema | undefined = undefined,
    BodySchema extends TSchema | undefined = undefined,
    ResponseSchemasMap extends Record<number, TSchema> | undefined = undefined
>(
    method: Method, pathTemplate: Path,
    config?: { schema?: RouteSchemaConfig<PathParamsSchema, QuerySchema, BodySchema, ResponseSchemasMap> }
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

    const routeSchema: RouteSchemaConfig<PathParamsSchema, QuerySchema, BodySchema, ResponseSchemasMap> = config?.schema ?? {};

    return {
        method,
        pathTemplate,
        buildPath,
        schema: routeSchema,
    };
}

// Path Parameter Helper
export type PathParams<TPath extends string> =
    TPath extends `${infer _Start}:${infer Param}/${infer Rest}` ? { [K in Param]: string | number } & PathParams<Rest> :
        TPath extends `${infer _Start}:${infer Param}` ? { [K in Param]: string | number } :
            Record<string, never>;

// Interface for the schema object within RouteDefinition
// Its properties (path, querystring, body, response) remain optional and match the FastifySchema for easy assignment.
interface RouteSchemaConfig<
    PathParamsSchema extends TSchema | undefined,
    QuerySchema extends TSchema | undefined,
    BodySchema extends TSchema | undefined,
    ResponseSchemasMap extends Record<number, TSchema> | undefined
> {
    path?: PathParamsSchema;
    querystring?: QuerySchema;
    body?: BodySchema;
    response?: ResponseSchemasMap;
}
