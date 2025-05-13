import {HttpClient} from "@angular/common/http";
import {RouteDefinition, PathParams} from "#shared/api-definitions";
import {TSchema, Static} from "@sinclair/typebox";
import {Observable} from "rxjs";

// Helper type to infer the success response type from TResponseSchemasMap
type InferSuccessResponse<TResponseSchemasMap extends Record<number, TSchema> | undefined> =
    TResponseSchemasMap extends undefined ? unknown :
    TResponseSchemasMap[200] extends TSchema ? Static<TResponseSchemasMap[200]> :
    TResponseSchemasMap[201] extends TSchema ? Static<TResponseSchemasMap[201]> :
    TResponseSchemasMap[204] extends TSchema ? void :
    unknown;

// Helper type for the structure of the arguments object passed to callRoute
type ArgsObject<
    TPath extends string,
    TBodySchema extends TSchema | undefined
> = (PathParams<TPath> extends Record<string, never> // If path string has no params
    ? { pathParams?: PathParams<TPath> }             // Then pathParams property is optional
    : { pathParams: PathParams<TPath> }              // Else, pathParams property is required
  ) & (TBodySchema extends TSchema                    // If a body schema is defined
    ? { body: Static<TBodySchema> }                  // Then body property is required and typed
    : { body?: never }                               // Else, body property is not expected (and cannot be passed)
  );

// Helper type to determine if the entire 'args' parameter for callRoute can be optional
type ArgsCanBeOptional<TPath extends string, TBodySchema extends TSchema | undefined> =
    PathParams<TPath> extends Record<string, never> // If path has no parameters
    ? TBodySchema extends undefined                 // AND no body schema is defined
        ? true                                      // Then args can be optional
        : false
    : false;

export function callApiRoute<
    TPath extends string,
    TMethod extends "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    TPathParamsSchema extends TSchema | undefined,
    TQuerySchema extends TSchema | undefined,
    TBodySchema extends TSchema | undefined,
    TResponseSchemasMap extends Record<number, TSchema> | undefined
>(
    httpClient: HttpClient,
    route: RouteDefinition<TPath, TMethod, TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>,
    ...argsParam: ArgsCanBeOptional<TPath, TBodySchema> extends true
        ? [ArgsObject<TPath, TBodySchema>?] // args object itself is optional
        : [ArgsObject<TPath, TBodySchema>]  // args object itself is required
): Observable<InferSuccessResponse<TResponseSchemasMap>> {
    const args = argsParam[0]; // Extract the actual args object, which might be undefined

    switch (route.method) {
        case "GET":
            // Provide default empty object for pathParams if args or args.pathParams is undefined
            return httpClient.get<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args?.pathParams || {} as PathParams<TPath>));
        case "POST":
            return httpClient.post<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args?.pathParams || {} as PathParams<TPath>), args?.body);
        case "PATCH":
            return httpClient.patch<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args?.pathParams || {} as PathParams<TPath>), args?.body);
        case "PUT":
            return httpClient.put<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args?.pathParams || {} as PathParams<TPath>), args?.body);
        case "DELETE":
            // HttpClient.delete expects options object, pass body within it
            return httpClient.delete<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args?.pathParams || {} as PathParams<TPath>), { body: args?.body });
        default:
            // Optional: Add exhaustive check for unhandled methods
            const _exhaustiveCheck: never = route.method;
            throw new Error(`Unhandled HTTP method: ${_exhaustiveCheck}`);
    }
}
