import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import type {
  RouteDefinition,
  InferParams,
  InferBody,
  InferResponse,
} from "@my-app/shared";

export interface ValidatedRequest<R> {
  params: InferParams<R>;
  body: InferBody<R>;
  raw: HttpRequest;
  context: InvocationContext;
}

export function registerRoute<
  R extends RouteDefinition<any, any, any, any, any>,
>(
  name: string,
  route: R,
  handler: (req: ValidatedRequest<R>) => Promise<InferResponse<R>>,
) {
  app.http(name, {
    methods: [route.method],
    authLevel: "anonymous",
    route: route.route,
    handler: async (
      request: HttpRequest,
      context: InvocationContext,
    ): Promise<HttpResponseInit> => {
      try {
        const params = route.params.parse(
          Object.fromEntries(
            Object.entries(request.params).map(([k, v]) => [k, v]),
          ),
        );

        let body: unknown = undefined;
        if (!(route.body instanceof z.ZodVoid)) {
          const raw = await request.json();
          body = route.body.parse(raw);
        }

        const result = await handler({
          params,
          body: body as InferBody<R>,
          raw: request,
          context,
        });

        const validated = route.response.parse(result);
        return { status: 200, jsonBody: validated };
      } catch (err) {
        if (err instanceof z.ZodError) {
          return { status: 400, jsonBody: { errors: err.flatten() } };
        }
        context.error("Unhandled error", err);
        return { status: 500, jsonBody: { error: "Internal server error" } };
      }
    },
  });
}
