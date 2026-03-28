import {
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import type { HttpRequestParser, HttpHandlerWithParser } from "./core.js";

// Variables

export type VariableKey<T> = symbol & { readonly _type: T };

export function createVariableKey<T>(description: string): VariableKey<T> {
  return Symbol(description) as VariableKey<T>;
}

export interface Variables {
  set<T>(key: VariableKey<T>, value: T): void;
  get<T>(key: VariableKey<T>): T | undefined;
}

export function createVars(): Variables {
  const store = new Map<symbol, unknown>();
  return {
    set(key, value) { store.set(key, value); },
    get(key) { return store.get(key) as any; },
  };
}

// Combination

export type NextMiddleware = () => Promise<HttpResponseInit>;

export interface MiddlewareContext {
  request: HttpRequest;
  context: InvocationContext;
  vars: Variables;
  next: NextMiddleware;
}

export type Middleware<
  TReturn extends HttpResponseInit = HttpResponseInit,
> = (c: MiddlewareContext) => Promise<TReturn | void>;

type ExtractMiddlewareReturn<T> =
  T extends (...args: any[]) => Promise<infer R>
    ? Exclude<R, void | undefined>
    : never;

export function combineMiddleware<const T extends readonly Middleware<any>[]>(
  middlewares: [...T],
): Middleware<ExtractMiddlewareReturn<T[number]>> {
  return ((c) => {
    const dispatch = (i: number): NextMiddleware =>
      async () => {
        if (i >= middlewares.length) return c.next();
        let nextResult: HttpResponseInit | undefined;
        const innerNext: NextMiddleware = async () => {
          nextResult = await dispatch(i + 1)();
          return nextResult;
        };
        const middlewareResult = await middlewares[i]({ ...c, next: innerNext });
        return (middlewareResult ?? nextResult)!;
      };
    return dispatch(0)();
  }) as Middleware<ExtractMiddlewareReturn<T[number]>>;
}

// Request handling

export interface MiddlewareHandlerContext<TParsed = void> {
  request: HttpRequest;
  context: InvocationContext;
  vars: Variables;
  parsed: TParsed;
}

type ExtractParsed<TParser extends HttpRequestParser | undefined> =
  TParser extends HttpRequestParser
    ? (TParser extends { query: infer Q extends z.ZodTypeAny } ? { query: z.infer<Q> } : {}) &
      (TParser extends { body: infer B extends z.ZodTypeAny } ? { body: z.infer<B> } : {})
    : void;

export type MiddlewareHandler<
  TParser extends HttpRequestParser | undefined = undefined,
  TReturn extends HttpResponseInit = HttpResponseInit
> = (c: MiddlewareHandlerContext<ExtractParsed<TParser>>) => Promise<TReturn>;

export function withMiddleware<
  TParser extends HttpRequestParser | undefined,
  TReturn extends HttpResponseInit,
  const TMiddlewares extends readonly Middleware<any>[],
>(
  middlewares: [...TMiddlewares],
  handler: MiddlewareHandler<TParser, TReturn>,
): HttpHandlerWithParser<
  TParser,
  TReturn | ExtractMiddlewareReturn<TMiddlewares[number]>
> {
  const middleware: Middleware = middlewares.length === 1
    ? middlewares[0]
    : combineMiddleware(middlewares);

  return (async (request, context, parser) => {
    const vars = createVars();
    let handlerResult: HttpResponseInit | undefined;

    const next: NextMiddleware = async () => {
      let parsed: unknown = undefined;
      if (parser) {
        const result: Record<string, unknown> = {};
        if (parser.body) {
          result.body = parser.body.parse(await request.json());
        }
        if (parser.query) {
          result.query = parser.query.parse(Object.fromEntries(request.query));
        }
        parsed = result;
      }
      handlerResult = await handler({ request, context, vars, parsed: parsed as any });
      return handlerResult;
    };

    const middlewareResult = await middleware({ request, context, vars, next });
    return (middlewareResult ?? handlerResult)!;
  }) as HttpHandlerWithParser<TParser, TReturn | ExtractMiddlewareReturn<TMiddlewares[number]>>;
}

// Error handling

export const catchError = (async (c) => {
  try {
    await c.next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, jsonBody: { message: "Bad Request", error: error.flatten() } } as const;
    }
    if (error instanceof SyntaxError) {
      return { status: 400, jsonBody: { message: "Bad Request", error: error.message } } as const;
    }
    c.context.error("Internal Server Error", error);
    return { status: 500, jsonBody: { message: "Internal Server Error" } } as const;
  }
}) satisfies Middleware;

export function withCatchError<
  TParser extends HttpRequestParser | undefined,
  TReturn extends HttpResponseInit,
>(handler: MiddlewareHandler<TParser, TReturn>) {
  return withMiddleware([catchError], handler);
}
