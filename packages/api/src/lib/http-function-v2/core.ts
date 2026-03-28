import {
  type app as App,
  type HttpFunctionOptions,
  type HttpMethod,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import type { z } from "zod";

// Response type extraction

declare const ResponseType: unique symbol;

type ExtractResponse<T> = T extends any
  ? {
      status: T extends { status: infer S extends number } ? S : 200;
      body: T extends { jsonBody: infer J }
        ? J
        : T extends { body: any }
          ? unknown
          : void;
    }
  : never;

// Parser

export type HttpFunctionParser = {
  query?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
};

// Handler

export type HttpHandlerWithParser<
  TParser extends HttpFunctionParser | undefined = undefined,
  TReturn extends HttpResponseInit = HttpResponseInit,
> = (
  request: HttpRequest,
  context: InvocationContext,
  parser: TParser,
) => Promise<TReturn>;

// Definition

const HttpFunctionDefinitionBrand = Symbol("HttpFunctionDefinition");

export interface HttpFunctionDefinition<
  TParser extends HttpFunctionParser | undefined,
  TResponse,
> {
  readonly [HttpFunctionDefinitionBrand]: true;
  options: Omit<HttpFunctionOptions, "handler" | "methods" | "route">;
  parser: TParser;
  handler: HttpHandlerWithParser<TParser, any>;
  [ResponseType]: TResponse;
}

function isHttpFunctionDefinition(value: unknown): value is HttpFunctionDefinition<any, any> {
  return typeof value === "object" && value !== null && HttpFunctionDefinitionBrand in value;
}

export function http<
  const TOptions extends Omit<HttpFunctionOptions, "handler" | "methods" | "route">,
  TParser extends HttpFunctionParser | undefined = undefined,
  TReturn extends HttpResponseInit = HttpResponseInit,
>(
  options: TOptions & {
    parser?: TParser;
    handler: HttpHandlerWithParser<TParser, TReturn>;
  },
): HttpFunctionDefinition<TParser, ExtractResponse<TReturn>> {
  const { handler, parser, ...rest } = options as any;
  return {
    [HttpFunctionDefinitionBrand]: true,
    options: rest,
    parser: parser ?? undefined,
    handler,
  } as any;
}

// Registration

function registerSingle(
  app: typeof App, name: string, method: HttpMethod, route: string, def: HttpFunctionDefinition<any, any>
): void {
  app.http(name, {
    ...def.options,
    methods: [method],
    route,
    handler: async (
      request: HttpRequest,
      context: InvocationContext,
    ): Promise<HttpResponseInit> => {
      return def.handler(request, context, def.parser);
    },
  });
}

export interface HttpFunctionDefinitionTree {
  [key: string]: HttpFunctionDefinition<any, any> | HttpFunctionDefinitionTree;
};

export function registerAll(
  app: typeof App,
  tree: HttpFunctionDefinitionTree,
  namePrefix = "",
  routePrefix = "",
): void {
  for (const [key, value] of Object.entries(tree)) {
    const name = namePrefix ? `${namePrefix}-${key}` : key;
    const route = routePrefix ? `${routePrefix}/${key}` : key;
    if (isHttpFunctionDefinition(value)) {
      const method = key.startsWith("get") ? "GET" : "POST";
      registerSingle(app, name, method, route, value);
    } else {
      registerAll(app, value, name, route);
    }
  }
}
