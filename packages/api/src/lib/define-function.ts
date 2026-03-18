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
  [ResponseType]: TResponse;
}

type ExtractStatus<T> = T extends { status: infer S extends number } ? S : 200;

type ExtractBody<T> = T extends { jsonBody: infer J }
  ? J
  : T extends { body: any }
    ? unknown
    : void;

type ExtractResponse<T> = { status: ExtractStatus<T>; body: ExtractBody<T> };

export function defineFunction<
  const TOptions extends Omit<HttpFunctionOptions, "handler" | "methods" | "route">,
  const TParse extends { body?: z.ZodTypeAny; headers?: z.ZodTypeAny } = {},
  TReturn extends HttpResponseInit = HttpResponseInit,
>(
  options: TOptions & {
    parse?: TParse;
    handler: (
      request: HttpRequest,
      context: InvocationContext,
      parsed: ParsedInput<TParse>,
    ) => Promise<TReturn>;
  },
): FunctionDefinition<TOptions & { parse: ParseConfig<TParse> }, ExtractResponse<TReturn>> {
  const { handler, parse, ...rest } = options as any;
  const config = {
    ...rest,
    parse: {
      body: parse?.body ?? z.void(),
      headers: parse?.headers ?? z.void(),
    },
  };
  return { config, handler } as FunctionDefinition<
    TOptions & { parse: ParseConfig<TParse> },
    ExtractResponse<TReturn>
  >;
}
