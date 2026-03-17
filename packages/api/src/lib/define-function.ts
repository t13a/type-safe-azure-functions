import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { z } from "zod";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

declare const ResponseType: unique symbol;

type DefaultParams = z.ZodObject<{}, "strip", z.ZodTypeAny>;

type WithDefaults<T> = {
  method: T extends { method: infer M extends HttpMethod } ? M : never;
  route: T extends { route: infer R extends string } ? R : never;
  params: T extends { params: infer P extends z.ZodTypeAny }
    ? P
    : DefaultParams;
  body: T extends { body: infer B extends z.ZodTypeAny } ? B : z.ZodVoid;
};

export type ParsedInput<C> = {
  params: C extends { params: infer P extends z.ZodTypeAny }
    ? z.infer<P>
    : Record<string, never>;
  body: C extends { body: infer B extends z.ZodTypeAny } ? z.infer<B> : void;
};

export interface FunctionDefinition<
  TConfig extends { method: HttpMethod; route: string; params: z.ZodTypeAny; body: z.ZodTypeAny },
  TResponse,
> {
  config: TConfig;
  fn: (
    request: HttpRequest,
    context: InvocationContext,
    parsed: ParsedInput<TConfig>,
  ) => Promise<HttpResponseInit>;
  [ResponseType]: TResponse;
}

type ExtractResponse<T> = T extends { jsonBody: infer J }
  ? J
  : T extends { body: any }
    ? unknown
    : void;

export function defineFunction<
  const TConfig extends {
    method: HttpMethod;
    route: string;
    params?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
  },
  TReturn extends HttpResponseInit,
>(
  config: TConfig,
  fn: (
    request: HttpRequest,
    context: InvocationContext,
    parsed: ParsedInput<WithDefaults<TConfig>>,
  ) => Promise<TReturn>,
): FunctionDefinition<WithDefaults<TConfig>, ExtractResponse<TReturn>> {
  const resolved = {
    ...config,
    params: config.params ?? z.object({}),
    body: config.body ?? z.void(),
  };
  return { config: resolved, fn } as unknown as FunctionDefinition<
    WithDefaults<TConfig>,
    ExtractResponse<TReturn>
  >;
}
