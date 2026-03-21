import {
  type app as App,
  type HttpFunctionOptions,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";

// Context propagation

export type ContextKey<T> = symbol & { readonly _type: T };

export function createContextKey<T>(description: string): ContextKey<T> {
  return Symbol(description) as ContextKey<T>;
}

export interface Locals {
  set<T>(key: ContextKey<T>, value: T): void;
  get<T>(key: ContextKey<T>): T;
  has(key: ContextKey<any>): boolean;
}

export function createLocals(): Locals {
  const store = new Map<symbol, unknown>();
  return {
    set(key, value) { store.set(key, value); },
    get(key) {
      if (!store.has(key)) throw new Error(`Context key not set: ${key.description}`);
      return store.get(key) as any;
    },
    has(key) { return store.has(key); },
  };
}

// Middleware

export type HttpMiddlewareNext = () => Promise<HttpResponseInit>;

export interface HttpMiddlewareContext {
  request: HttpRequest;
  context: InvocationContext;
  next: HttpMiddlewareNext;
  locals: Locals;
}

export type HttpMiddleware<
  TReturn extends HttpResponseInit = HttpResponseInit,
> = (c: HttpMiddlewareContext) => Promise<TReturn | void>;

export const defaultMiddleware = (async ({ next, context }) => {
  try {
    await next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, jsonBody: { message: "Bad Request", error: error.flatten() } } as const;
    }
    if (error instanceof SyntaxError) {
      return { status: 400, jsonBody: { message: "Bad Request", error: error.message } } as const;
    }
    context.error("Internal Server Error", error);
    return { status: 500, jsonBody: { message: "Internal Server Error" } } as const;
  }
}) satisfies HttpMiddleware;

// Handler

export interface HttpHandlerContext<TParsed = void> {
  request: HttpRequest;
  context: InvocationContext;
  parsed: TParsed;
  locals: Locals;
}

export type ParsedHttpHandler<
  TParser extends z.ZodTypeAny = z.ZodVoid,
  TReturn extends HttpResponseInit = HttpResponseInit
> = (c: HttpHandlerContext<z.infer<TParser>>) => Promise<TReturn>;

// Definition

const HttpFunctionDefinitionBrand = Symbol("HttpFunctionDefinition");

declare const ResponseType: unique symbol;

export interface HttpFunctionDefinition<
  TParser extends z.ZodTypeAny | undefined,
  TResponse,
> {
  readonly [HttpFunctionDefinitionBrand]: true;
  options: Omit<HttpFunctionOptions, "handler" | "methods" | "route">;
  middleware: HttpMiddleware;
  parser: TParser;
  handler: ParsedHttpHandler<TParser extends z.ZodTypeAny ? TParser : z.ZodVoid>;
  [ResponseType]: TResponse;
}

function isHttpFunctionDefinition(value: unknown): value is HttpFunctionDefinition<any, any> {
  return typeof value === "object" && value !== null && HttpFunctionDefinitionBrand in value;
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
    middleware?: (c: HttpMiddlewareContext) => Promise<TMiddlewareReturn>;
    parser?: TParser;
    handler: ParsedHttpHandler<TParser, TReturn>;
  },
): HttpFunctionDefinition<
  TParser extends z.ZodVoid ? undefined : TParser,
  ExtractResponse<TReturn> | ExtractResponse<Exclude<TMiddlewareReturn, void>>
> {
  const { handler, middleware, parser, ...rest } = options as any;
  return {
    [HttpFunctionDefinitionBrand]: true,
    options: rest,
    middleware: middleware ?? defaultMiddleware,
    parser: parser ?? undefined,
    handler,
  } as any;
}

// Registration

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
      const locals = createLocals();
      let handlerResult: HttpResponseInit | undefined;
      const next: HttpMiddlewareNext = async () => {
        let parsed: unknown = undefined;
        if (def.parser) {
          const raw = await request.json();
          parsed = def.parser.parse(raw);
        }
        handlerResult = await def.handler({ request, context, parsed: parsed as any, locals });
        return handlerResult;
      };
      const middlewareResult = await def.middleware({ request, context, next, locals });
      return middlewareResult ?? handlerResult!;
    },
  });
}

export interface HttpFunctionDefinitionTree {
  [key: string]: HttpFunctionDefinition<any, any> | HttpFunctionDefinitionTree;
};

export function registerHttpAll(
  app: typeof App,
  tree: HttpFunctionDefinitionTree,
  namePrefix = "",
  routePrefix = "",
): void {
  for (const [key, value] of Object.entries(tree)) {
    const name = namePrefix ? `${namePrefix}-${key}` : key;
    const route = routePrefix ? `${routePrefix}/${key}` : key;
    if (isHttpFunctionDefinition(value)) {
      registerHttp(app, name, route, value);
    } else {
      registerHttpAll(app, value as HttpFunctionDefinitionTree, name, route);
    }
  }
}

// Middleware composition

type ExtractMiddlewareReturn<T> =
  T extends (...args: any[]) => Promise<infer R>
    ? Exclude<R, void | undefined>
    : never;

export function combineMiddleware<const T extends readonly HttpMiddleware<any>[]>(
  middlewares: [...T],
): HttpMiddleware<ExtractMiddlewareReturn<T[number]>> {
  return (({ request, context, next, locals }) => {
    const dispatch = (i: number): HttpMiddlewareNext =>
      async () => {
        if (i >= middlewares.length) return next();
        let nextResult: HttpResponseInit | undefined;
        const innerNext: HttpMiddlewareNext = async () => {
          nextResult = await dispatch(i + 1)();
          return nextResult;
        };
        const middlewareResult = await middlewares[i]({ request, context, next: innerNext, locals });
        return (middlewareResult ?? nextResult)!;
      };
    return dispatch(0)();
  }) as HttpMiddleware<ExtractMiddlewareReturn<T[number]>>;
}
