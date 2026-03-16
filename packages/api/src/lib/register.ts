import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import type { FunctionDefinition } from "./define-function.js";

export function registerAll(
  functions: Record<string, FunctionDefinition<any, any>>,
): void {
  for (const [name, def] of Object.entries(functions)) {
    app.http(name, {
      methods: [def.config.method],
      authLevel: "anonymous",
      route: def.config.route,
      handler: async (
        request: HttpRequest,
        context: InvocationContext,
      ): Promise<HttpResponseInit> => {
        try {
          const params = def.config.params.parse(
            Object.fromEntries(Object.entries(request.params)),
          );

          let body: unknown = undefined;
          if (!(def.config.body instanceof z.ZodVoid)) {
            const raw = await request.json();
            body = def.config.body.parse(raw);
          }

          return await def.fn(request, context, { params, body });
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
}
