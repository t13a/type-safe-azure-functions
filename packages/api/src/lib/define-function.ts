import {
  type HttpFunctionOptions,
  type HttpMethod,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";

declare const ResponseType: unique symbol;

type DefaultParams = z.ZodObject<{}, "strip", z.ZodTypeAny>;

type ParseConfig = {
  params?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
};

type NormalizeParse<T> = {
  params: T extends { params: infer P extends z.ZodTypeAny } ? P : DefaultParams;
  body: T extends { body: infer B extends z.ZodTypeAny } ? B : z.ZodVoid;
};

export type ParsedInput<T> = {
  params: T extends { params: infer P extends z.ZodTypeAny } ? z.infer<P> : Record<string, never>;
  body: T extends { body: infer B extends z.ZodTypeAny } ? z.infer<B> : void;
};

export interface FunctionDefinition<
  TConfig extends {
    methods: HttpMethod[];
    route: string;
    parse: { params: z.ZodTypeAny; body: z.ZodTypeAny };
  },
  TResponse,
> {
  config: TConfig;
  fn: (
    request: HttpRequest,
    context: InvocationContext,
    parsed: ParsedInput<TConfig["parse"]>,
  ) => Promise<HttpResponseInit>;
  [ResponseType]: TResponse;
}

type ExtractResponse<T> = T extends { jsonBody: infer J }
  ? J
  : T extends { body: any }
    ? unknown
    : void;

export function defineFunction<
  const TOptions extends Omit<HttpFunctionOptions, "handler"> & {
    methods: HttpMethod[];
    route: string;
  },
  const TParse extends ParseConfig = {},
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
): FunctionDefinition<TOptions & { parse: NormalizeParse<TParse> }, ExtractResponse<TReturn>> {
  const { handler, parse, ...rest } = options as any;
  const resolved = {
    ...rest,
    parse: {
      params: parse?.params ?? z.object({}),
      body: parse?.body ?? z.void(),
    },
  };
  return { config: resolved, fn: handler } as unknown as FunctionDefinition<
    TOptions & { parse: NormalizeParse<TParse> },
    ExtractResponse<TReturn>
  >;
}
