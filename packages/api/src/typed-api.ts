import {
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
  app,
} from "@azure/functions";
import { z } from "zod";

// --- HTTP メソッド（決め打ち → as const 不要に） ---

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

// --- ルート設定（response スキーマなし） ---

interface RouteConfig<
  TMethod extends HttpMethod,
  TPath extends string,
  TParams extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
> {
  method: TMethod;
  route: TPath;
  params: TParams;
  body: TBody;
}

// --- 関数に渡す追加の引数（1つにまとめる） ---

export type ParsedInput<C extends RouteConfig<any, any, any, any>> = {
  params: z.infer<C["params"]>;
  body: z.infer<C["body"]>;
};

// --- 関数定義オブジェクト ---

declare const ResponseType: unique symbol;

export interface FunctionDefinition<
  TConfig extends RouteConfig<any, any, any, any>,
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
  const TConfig extends RouteConfig<HttpMethod, string, z.ZodTypeAny, z.ZodTypeAny>,
  TReturn extends HttpResponseInit,
>(
  config: TConfig,
  fn: (
    request: HttpRequest,
    context: InvocationContext,
    parsed: ParsedInput<TConfig>,
  ) => Promise<TReturn>,
): FunctionDefinition<TConfig, ExtractResponse<TReturn>> {
  return { config, fn } as unknown as FunctionDefinition<TConfig, ExtractResponse<TReturn>>;
}

// --- registerAll: エントリーポイントで呼ぶ（ここで app.http() 実行） ---

export function registerAll(
  functions: Record<string, FunctionDefinition<any, any>>,
): void {
  for (const [name, def] of Object.entries(functions)) {
    app.http(name, {
      methods: [def.config.method],
      authLevel: "anonymous",
      route: def.config.route,
      handler: async (
        request: HttpRequest,
        context: InvocationContext,
      ): Promise<HttpResponseInit> => {
        try {
          const params = def.config.params.parse(
            Object.fromEntries(Object.entries(request.params)),
          );

          let body: unknown = undefined;
          if (!(def.config.body instanceof z.ZodVoid)) {
            const raw = await request.json();
            body = def.config.body.parse(raw);
          }

          return await def.fn(request, context, { params, body });
        } catch (err) {
          if (err instanceof z.ZodError) {
            return { status: 400, jsonBody: { errors: err.flatten() } };
          }
          context.error("Unhandled error", err);
          return { status: 500, jsonBody: { error: "Internal server error" } };
        }
      },
    });
  }
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
