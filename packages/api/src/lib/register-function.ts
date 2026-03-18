import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import type { FunctionDefinition } from "./define-function.js";

export function badRequest(err: z.ZodError) {
  return { status: 400 as const, jsonBody: { errors: err.flatten() } };
}

export function internalServerError() {
  return { status: 500 as const, jsonBody: { error: "Internal server error" } };
}

export function registerFunction(
  name: string, def: FunctionDefinition<any, any>
): void {
  const { parse, ...httpOptions } = def.config;

  app.http(name, {
    ...httpOptions,
    methods: ["POST"],
    route: name,
    handler: async (
      request: HttpRequest,
      context: InvocationContext,
    ): Promise<HttpResponseInit> => {
      try {
        const raw = (await request.json()) as { params?: unknown; body?: unknown };

        const params = parse.params.parse(raw.params ?? {});

        let body: unknown = undefined;
        if (!(parse.body instanceof z.ZodVoid)) {
          body = parse.body.parse(raw.body);
        }

        return await def.handler(request, context, { params, body });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return badRequest(err);
        }
        context.error("Unhandled error", err);
        return internalServerError();
      }
    },
  });
}
