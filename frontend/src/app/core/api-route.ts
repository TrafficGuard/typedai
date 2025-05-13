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

function callRoute<
    TPath extends string,
    TMethod extends "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    TPathParamsSchema extends TSchema | undefined,
    TQuerySchema extends TSchema | undefined,
    TBodySchema extends TSchema | undefined,
    TResponseSchemasMap extends Record<number, TSchema> | undefined
>(
    httpClient: HttpClient,
    route: RouteDefinition<TPath, TMethod, TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>, args:
    {
        pathParams?: PathParams<TPath>;
        body?: TBodySchema extends TSchema ? Static<TBodySchema> : undefined;
    }
): Observable<InferSuccessResponse<TResponseSchemasMap>> {

    switch (route.method) {
        case "GET":
            return httpClient.get<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args.pathParams));
        case "POST":
            return httpClient.post<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args.pathParams), args.body);
        case "PATCH":
            return httpClient.patch<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args.pathParams), args.body);
        case "PUT":
            return httpClient.put<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args.pathParams), args.body);
        case "DELETE":
            return httpClient.delete<InferSuccessResponse<TResponseSchemasMap>>(route.buildPath(args.pathParams), args.body);
    }

}
