import {
  type HttpFunctionOptions,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";

declare const ResponseType: unique symbol;

export type FunctionParse = {
  body?: z.ZodTypeAny;
  headers?: z.ZodTypeAny;
};

export type FunctionParsed<TParse extends FunctionParse> = {
  body: TParse extends { body: infer B extends z.ZodTypeAny } ? z.infer<B> : void;
  headers: TParse extends { headers: infer H extends z.ZodTypeAny } ? z.infer<H> : void;
}

export type FunctionHandler<
  TParse extends FunctionParse = {},
  TReturn extends HttpResponseInit = HttpResponseInit
> = (
  request: HttpRequest,
  context: InvocationContext,
  parsed: FunctionParsed<TParse>,
) => Promise<TReturn>;

export type FunctionErrorHandler<
  TError = unknown,
  TErrorReturn extends HttpResponseInit = HttpResponseInit
> = (
  request: HttpRequest,
  context: InvocationContext,
  error: TError,
) => TErrorReturn | Promise<TErrorReturn>;

export interface FunctionDefinition<
  TParse extends Required<FunctionParse>,
  TResponse,
> {
  options: Omit<HttpFunctionOptions, "handler" | "methods" | "route">;
  parse: TParse;
  handler: FunctionHandler<TParse>;
  errorHandler: FunctionErrorHandler;
  [ResponseType]: TResponse;
}

type NormalizeParse<T> = {
  body: T extends { body: infer B extends z.ZodTypeAny } ? B : z.ZodVoid;
  headers: T extends { headers: infer H extends z.ZodTypeAny } ? H : z.ZodVoid;
};

type ExtractStatus<T> = T extends { status: infer S extends number } ? S : 200;

type ExtractBody<T> = T extends { jsonBody: infer J }
  ? J
  : T extends { body: any }
    ? unknown
    : void;

type ExtractResponse<T> = T extends any
  ? { status: ExtractStatus<T>; body: ExtractBody<T> }
  : never;

export const defaultErrorHandler = ((_request, context, error) => {
  if (error instanceof z.ZodError) {
    return { status: 400 as const, jsonBody: { errors: error.flatten() } };
  }
  context.error("Unhandled error", error);
  return { status: 500 as const, jsonBody: { error: "Internal server error" } };
}) satisfies FunctionErrorHandler;

export function defineFunction<
  const TOptions extends Omit<HttpFunctionOptions, "handler" | "methods" | "route">,
  const TParse extends FunctionParse = {},
  TReturn extends HttpResponseInit = HttpResponseInit,
  TErrorReturn extends HttpResponseInit = ReturnType<typeof defaultErrorHandler>,
>(
  options: TOptions & {
    parse?: TParse;
    handler: FunctionHandler<TParse, TReturn>;
    errorHandler?: FunctionErrorHandler<unknown, TErrorReturn>;
  },
): FunctionDefinition<NormalizeParse<TParse>, ExtractResponse<TReturn | TErrorReturn>> {
  const { handler, errorHandler, parse, ...rest } = options as any;
  return {
    options: rest,
    parse: {
      body: parse?.body ?? z.void(),
      headers: parse?.headers ?? z.void(),
    },
    handler,
    errorHandler: errorHandler ?? defaultErrorHandler,
  } as FunctionDefinition<
    NormalizeParse<TParse>,
    ExtractResponse<TReturn | TErrorReturn>
  >;
}
