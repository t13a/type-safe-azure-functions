import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { z } from "zod";

// --- HTTP メソッド（決め打ち → as const 不要に） ---

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// --- 関数定義オブジェクト ---

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

// --- レスポンス型の抽出（三択） ---

type ExtractResponse<T> = T extends { jsonBody: infer J }
  ? J
  : T extends { body: any }
    ? unknown
    : void;

// --- defineFunction: ルート定義 + 関数実装を一体化（副作用なし） ---

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

// --- client 向け型ユーティリティ ---

export type InferParams<T> = T extends FunctionDefinition<infer C, any>
  ? z.infer<C["params"]>
  : never;

export type InferBody<T> = T extends FunctionDefinition<infer C, any>
  ? z.infer<C["body"]>
  : never;

export type InferResponse<T> = T extends FunctionDefinition<any, infer R>
  ? R
  : never;
