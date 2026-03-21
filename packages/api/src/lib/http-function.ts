import {
  type app as App,
  type HttpFunctionOptions,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";

declare const ResponseType: unique symbol;

export type HttpMiddlewareNext = (
  request: HttpRequest,
  context: InvocationContext
) => Promise<HttpResponseInit>;

export type HttpMiddleware<
  TReturn extends HttpResponseInit = HttpResponseInit,
> = (
  request: HttpRequest,
  context: InvocationContext,
  next: HttpMiddlewareNext,
) => Promise<TReturn | void>;

export const defaultMiddleware = (async (request, context, next) => {
  try {
    await next(request, context);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, jsonBody: { message: "Bad Request", errors: error.flatten() } } as const;
    }
    context.error("Internal Server Error", error);
    return { status: 500, jsonBody: { message: "Internal Server Error" } } as const;
  }
}) satisfies HttpMiddleware;

export type ParsedHttpHandler<
  TParser extends z.ZodTypeAny = z.ZodVoid,
  TReturn extends HttpResponseInit = HttpResponseInit
> = (
  request: HttpRequest,
  context: InvocationContext,
  parsed: z.infer<TParser>,
) => Promise<TReturn>;

export interface HttpFunctionDefinition<
  TParser extends z.ZodTypeAny | undefined,
  TResponse,
> {
  options: Omit<HttpFunctionOptions, "handler" | "methods" | "route">;
  middleware: HttpMiddleware;
  parser: TParser;
  handler: ParsedHttpHandler<TParser extends z.ZodTypeAny ? TParser : z.ZodVoid>;
  [ResponseType]: TResponse;
}

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

export function defineHttp<
  const TOptions extends Omit<HttpFunctionOptions, "handler" | "methods" | "route">,
  TParser extends z.ZodTypeAny = z.ZodVoid,
  TReturn extends HttpResponseInit = HttpResponseInit,
  TMiddlewareReturn = Awaited<ReturnType<typeof defaultMiddleware>> | void,
>(
  options: TOptions & {
    middleware?: (
      request: HttpRequest,
      context: InvocationContext,
      next: HttpMiddlewareNext,
    ) => Promise<TMiddlewareReturn>;
    parser?: TParser;
    handler: ParsedHttpHandler<TParser, TReturn>;
  },
): HttpFunctionDefinition<
  TParser extends z.ZodVoid ? undefined : TParser,
  ExtractResponse<TReturn> | ExtractResponse<Exclude<TMiddlewareReturn, void>>
> {
  const { handler, middleware, parser, ...rest } = options as any;
  return {
    options: rest,
    middleware: middleware ?? defaultMiddleware,
    parser: parser ?? undefined,
    handler,
  } as any;
}

function registerHttp(
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
      let handlerResult: HttpResponseInit | undefined;
      const next = async (req: HttpRequest, ctx: InvocationContext) => {
        let parsed: unknown = undefined;
        if (def.parser) {
          const raw = await req.json();
          parsed = def.parser.parse(raw);
        }
        handlerResult = await def.handler(req, ctx, parsed as any);
        return handlerResult;
      };
      const middlewareResult = await def.middleware(request, context, next);
      return middlewareResult ?? handlerResult!;
    },
  });
}

export interface HttpFunctionDefinitionTree {
  [key: string]: HttpFunctionDefinition<any, any> | HttpFunctionDefinitionTree;
};

function isDefinition(value: unknown): value is HttpFunctionDefinition<any, any> {
  return typeof value === "object" && value !== null && "handler" in value;
}

export function registerHttpAll(
  app: typeof App,
  tree: HttpFunctionDefinitionTree,
  namePrefix = "",
  routePrefix = "",
): void {
  for (const [key, value] of Object.entries(tree)) {
    const name = namePrefix ? `${namePrefix}-${key}` : key;
    const route = routePrefix ? `${routePrefix}/${key}` : key;
    if (isDefinition(value)) {
      registerHttp(app, name, route, value);
    } else {
      registerHttpAll(app, value as HttpFunctionDefinitionTree, name, route);
    }
  }
}

type ExtractMiddlewareReturn<T> =
  T extends (...args: any[]) => Promise<infer R>
    ? Exclude<R, void | undefined>
    : never;

export function combineMiddleware<const T extends readonly HttpMiddleware<any>[]>(
  middlewares: [...T],
): HttpMiddleware<ExtractMiddlewareReturn<T[number]>> {
  return ((request, context, next) => {
    const dispatch = (i: number): HttpMiddlewareNext =>
      async (req, ctx) => {
        if (i >= middlewares.length) return next(req, ctx);
        let nextResult: HttpResponseInit | undefined;
        const innerNext: HttpMiddlewareNext = async (r, c) => {
          nextResult = await dispatch(i + 1)(r, c);
          return nextResult;
        };
        const middlewareResult = await middlewares[i](req, ctx, innerNext);
        return (middlewareResult ?? nextResult)!;
      };
    return dispatch(0)(request, context);
  }) as HttpMiddleware<ExtractMiddlewareReturn<T[number]>>;
}
