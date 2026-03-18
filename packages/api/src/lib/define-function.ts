import {
  type HttpFunctionOptions,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";

declare const ResponseType: unique symbol;

type DefaultParams = z.ZodObject<{}, "strip", z.ZodTypeAny>;

type ParseConfig<T> = {
  params: T extends { params: infer P extends z.ZodTypeAny } ? P : DefaultParams;
  body: T extends { body: infer B extends z.ZodTypeAny } ? B : z.ZodVoid;
};

export type ParsedInput<T> = {
  params: T extends { params: infer P extends z.ZodTypeAny } ? z.infer<P> : Record<string, never>;
  body: T extends { body: infer B extends z.ZodTypeAny } ? z.infer<B> : void;
};

export interface FunctionDefinition<
  TConfig extends {
    parse: { params: z.ZodTypeAny; body: z.ZodTypeAny };
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
  const TOptions extends Omit<HttpFunctionOptions, "handler">,
  const TParse extends { params?: z.ZodTypeAny; body?: z.ZodTypeAny } = {},
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
      params: parse?.params ?? z.object({}),
      body: parse?.body ?? z.void(),
    },
  };
  return { config, handler } as FunctionDefinition<
    TOptions & { parse: ParseConfig<TParse> },
    ExtractResponse<TReturn>
  >;
}
