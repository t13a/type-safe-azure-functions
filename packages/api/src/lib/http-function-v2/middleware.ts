import {
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import type { HttpFunctionParser, HttpHandlerWithParser } from "./core.js";

// Parsed type extraction

type ExtractParsed<TParser extends HttpFunctionParser | undefined> =
  TParser extends HttpFunctionParser
    ? (TParser extends { query: infer Q extends z.ZodTypeAny } ? { query: z.infer<Q> } : {}) &
      (TParser extends { body: infer B extends z.ZodTypeAny } ? { body: z.infer<B> } : {})
    : void;

// Context propagation

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

// Middleware

export type HttpMiddlewareNext = () => Promise<HttpResponseInit>;

export interface HttpMiddlewareContext {
  request: HttpRequest;
  context: InvocationContext;
  vars: Variables;
  next: HttpMiddlewareNext;
}

export type HttpMiddleware<
  TReturn extends HttpResponseInit = HttpResponseInit,
> = (c: HttpMiddlewareContext) => Promise<TReturn | void>;

// Middleware composition

type ExtractMiddlewareReturn<T> =
  T extends (...args: any[]) => Promise<infer R>
    ? Exclude<R, void | undefined>
    : never;

export function combineMiddleware<const T extends readonly HttpMiddleware<any>[]>(
  middlewares: [...T],
): HttpMiddleware<ExtractMiddlewareReturn<T[number]>> {
  return ((c) => {
    const dispatch = (i: number): HttpMiddlewareNext =>
      async () => {
        if (i >= middlewares.length) return c.next();
        let nextResult: HttpResponseInit | undefined;
        const innerNext: HttpMiddlewareNext = async () => {
          nextResult = await dispatch(i + 1)();
          return nextResult;
        };
        const middlewareResult = await middlewares[i]({ ...c, next: innerNext });
        return (middlewareResult ?? nextResult)!;
      };
    return dispatch(0)();
  }) as HttpMiddleware<ExtractMiddlewareReturn<T[number]>>;
}

// Handler

export interface HttpHandlerContext<TParsed = void> {
  request: HttpRequest;
  context: InvocationContext;
  vars: Variables;
  parsed: TParsed;
}

export type ParsedHttpHandler<
  TParser extends HttpFunctionParser | undefined = undefined,
  TReturn extends HttpResponseInit = HttpResponseInit
> = (c: HttpHandlerContext<ExtractParsed<TParser>>) => Promise<TReturn>;

// withMiddleware

export function withMiddleware<
  TParser extends HttpFunctionParser | undefined,
  TReturn extends HttpResponseInit,
  const TMiddlewares extends readonly HttpMiddleware<any>[],
>(
  middlewares: [...TMiddlewares],
  handler: ParsedHttpHandler<TParser, TReturn>,
): HttpHandlerWithParser<
  TParser,
  TReturn | ExtractMiddlewareReturn<TMiddlewares[number]>
> {
  const middleware: HttpMiddleware = middlewares.length === 1
    ? middlewares[0]
    : combineMiddleware(middlewares);

  return (async (request, context, parser) => {
    const vars = createVars();
    let handlerResult: HttpResponseInit | undefined;

    const next: HttpMiddlewareNext = async () => {
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

// Catch error middleware

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
}) satisfies HttpMiddleware;

export function withCatchError<
  TParser extends HttpFunctionParser | undefined,
  TReturn extends HttpResponseInit,
>(handler: ParsedHttpHandler<TParser, TReturn>) {
  return withMiddleware([catchError], handler);
}
