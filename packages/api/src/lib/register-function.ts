import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import type { FunctionDefinition } from "./define-function.js";

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
        let body: unknown = undefined;
        if (!(parse.body instanceof z.ZodVoid)) {
          const raw = await request.json();
          body = parse.body.parse(raw);
        }

        const parsed: Record<string, unknown> = { body };
        if (!(parse.headers instanceof z.ZodVoid)) {
          const raw = Object.fromEntries(request.headers.entries());
          parsed.headers = parse.headers.parse(raw);
        }

        return await def.handler(request, context, parsed as any);
      } catch (err) {
        return await def.errorHandler(request, context, err);
      }
    },
  });
}
