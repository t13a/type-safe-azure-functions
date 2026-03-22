import {
  type app as App,
  type HttpFunctionOptions,
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

// Handler

export type HttpHandlerWithParser<
  TParser extends z.ZodTypeAny | undefined = undefined,
  TReturn extends HttpResponseInit = HttpResponseInit,
> = (
  request: HttpRequest,
  context: InvocationContext,
  parser: TParser,
) => Promise<TReturn>;

// Definition

const HttpFunctionDefinitionBrand = Symbol("HttpFunctionDefinition");

export interface HttpFunctionDefinition<
  TParser extends z.ZodTypeAny | undefined,
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
  TParser extends z.ZodTypeAny = z.ZodVoid,
  TReturn extends HttpResponseInit = HttpResponseInit,
>(
  options: TOptions & {
    parser?: TParser;
    handler: HttpHandlerWithParser<TParser extends z.ZodVoid ? undefined : TParser, TReturn>;
  },
): HttpFunctionDefinition<
  TParser extends z.ZodVoid ? undefined : TParser,
  ExtractResponse<TReturn>
> {
  const { handler, parser, ...rest } = options as any;
  return {
    [HttpFunctionDefinitionBrand]: true,
    options: rest,
    parser: parser ?? undefined,
    handler,
  } as any;
}

// Sub-route

const SubRouteBrand = Symbol("SubRoute");

export type SubRouteNode<T extends Record<string, any>> = T & {
  readonly [SubRouteBrand]: true;
};

function isSubRouteNode(value: unknown): value is SubRouteNode<any> {
  return typeof value === "object" && value !== null && SubRouteBrand in value;
}

export function subRoute<T extends Record<string, any>>(tree: T): SubRouteNode<T> {
  return { ...tree, [SubRouteBrand]: true } as SubRouteNode<T>;
}

// Registration

function registerSingle(
  app: typeof App, name: string, route: string, def: HttpFunctionDefinition<any, any>
): void {
  app.http(name, {
    ...def.options,
    methods: ["POST"],
    route,
    handler: async (
      request: HttpRequest,
      context: InvocationContext,
    ): Promise<HttpResponseInit> => {
      return def.handler(request, context, def.parser);
    },
  });
}

export function registerAll(
  app: typeof App,
  tree: Record<string, HttpFunctionDefinition<any, any> | SubRouteNode<any>>,
  namePrefix = "",
  routePrefix = "",
): void {
  for (const [key, value] of Object.entries(tree)) {
    const name = namePrefix ? `${namePrefix}-${key}` : key;
    const route = routePrefix ? `${routePrefix}/${key}` : key;
    if (isSubRouteNode(value)) {
      registerAll(app, value as any, name, route);
    } else if (isHttpFunctionDefinition(value)) {
      registerSingle(app, name, route, value);
    }
  }
}
