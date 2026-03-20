import {
  type HttpFunctionOptions,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";

declare const ResponseType: unique symbol;

type ParseConfig<T> = {
  body: T extends { body: infer B extends z.ZodTypeAny } ? B : z.ZodVoid;
  headers: T extends { headers: infer H extends z.ZodTypeAny } ? H : z.ZodVoid;
};

export type ParsedInput<T> = {
  body: T extends { body: infer B extends z.ZodTypeAny } ? z.infer<B> : void;
} & (T extends { headers: infer H extends z.ZodTypeAny }
  ? { headers: z.infer<H> }
  : {});

export interface FunctionDefinition<
  TConfig extends {
    parse: { body: z.ZodTypeAny; headers: z.ZodTypeAny };
  },
  TResponse,
> {
  config: TConfig;
  handler: (
    request: HttpRequest,
    context: InvocationContext,
    parsed: ParsedInput<TConfig["parse"]>,
  ) => Promise<HttpResponseInit>;
  errorHandler: (
    request: HttpRequest,
    context: InvocationContext,
    error: unknown,
  ) => HttpResponseInit | Promise<HttpResponseInit>;
  [ResponseType]: TResponse;
}

type ExtractStatus<T> = T extends { status: infer S extends number } ? S : 200;

type ExtractBody<T> = T extends { jsonBody: infer J }
  ? J
  : T extends { body: any }
    ? unknown
    : void;

type ExtractResponse<T> = T extends any
  ? { status: ExtractStatus<T>; body: ExtractBody<T> }
  : never;

export function defaultErrorHandler(
  _request: HttpRequest,
  context: InvocationContext,
  error: unknown,
) {
  if (error instanceof z.ZodError) {
    return { status: 400 as const, jsonBody: { errors: error.flatten() } };
  }
  context.error("Unhandled error", error);
  return { status: 500 as const, jsonBody: { error: "Internal server error" } };
}

export function defineFunction<
  const TOptions extends Omit<HttpFunctionOptions, "handler" | "methods" | "route">,
  const TParse extends { body?: z.ZodTypeAny; headers?: z.ZodTypeAny } = {},
  TReturn extends HttpResponseInit = HttpResponseInit,
  TErrorReturn extends HttpResponseInit = ReturnType<typeof defaultErrorHandler>,
>(
  options: TOptions & {
    parse?: TParse;
    handler: (
      request: HttpRequest,
      context: InvocationContext,
      parsed: ParsedInput<TParse>,
    ) => Promise<TReturn>;
    errorHandler?: (
      request: HttpRequest,
      context: InvocationContext,
      error: unknown,
    ) => TErrorReturn | Promise<TErrorReturn>;
  },
): FunctionDefinition<TOptions & { parse: ParseConfig<TParse> }, ExtractResponse<TReturn | TErrorReturn>> {
  const { handler, errorHandler, parse, ...rest } = options as any;
  const config = {
    ...rest,
    parse: {
      body: parse?.body ?? z.void(),
      headers: parse?.headers ?? z.void(),
    },
  };
  return { config, handler, errorHandler: errorHandler ?? defaultErrorHandler } as FunctionDefinition<
    TOptions & { parse: ParseConfig<TParse> },
    ExtractResponse<TReturn | TErrorReturn>
  >;
}
