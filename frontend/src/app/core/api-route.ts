import {HttpClient} from "@angular/common/http";
import {RouteDefinition} from "#shared/api-definitions";
import {TSchema} from "@sinclair/typebox";
import {Observable} from "rxjs";

function callRoute<TPath extends string, TMethod extends "GET" | "POST" | "PUT" | "PATCH" | "DELETE", TPathParamsSchema extends TSchema, TQuerySchema extends TSchema, TBodySchema extends TSchema, TResponseSchemasMap extends Record<number, TSchema>>(
    httpClient: HttpClient,
    route: RouteDefinition<TPath, TMethod, TPathParamsSchema, TQuerySchema, TBodySchema, TResponseSchemasMap>, args:
    {
        pathParams?: TPathParamsSchema
        body?: TBodySchema
    }): Observable<any> { // TODO Extract 2xx type from TResponseSchemasMap

    switch (route.method) {
        case "GET":
            return httpClient.get(route.buildPath(args.pathParams)); // TODO TS2345: Argument of type TPathParamsSchema is not assignable to parameter of type PathParams<TPath>. Type TSchema is not assignable to type PathParams<TPath>
        case "POST":
            return httpClient.post(route.buildPath(args.pathParams), args.body);
        // case ...
    }

}