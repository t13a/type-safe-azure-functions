import type { FunctionDefinition, InferResponse } from "@my-app/api";
import { z } from "zod";

// --- fetch Response に型付き json() を追加 ---

interface TypedResponse<T> extends Response {
  json(): Promise<T>;
}

// --- params/body の有無に応じた入力型を構築 ---

type ClientInput<T> = T extends FunctionDefinition<infer C, any>
  ? (z.infer<C["params"]> extends Record<string, never>
      ? {}
      : { params: z.infer<C["params"]> }) &
      (C["body"] extends z.ZodVoid ? {} : { body: z.input<C["body"]> })
  : never;

type ClientMethod<T> = keyof ClientInput<T> extends never
  ? () => Promise<TypedResponse<InferResponse<T>>>
  : (input: ClientInput<T>) => Promise<TypedResponse<InferResponse<T>>>;

// --- 関数マップからメソッドマップを生成 ---

type ApiClient<T extends Record<string, FunctionDefinition<any, any>>> = {
  [K in keyof T]: ClientMethod<T[K]>;
};

// --- URL 構築 ---

function buildUrl(
  baseUrl: string,
  route: string,
  params: Record<string, string>,
): string {
  let path = route;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value));
  }
  return `${baseUrl}/api/${path}`;
}

// --- クライアント生成 ---

export function createClient<
  T extends Record<string, FunctionDefinition<any, any>>,
>(baseUrl: string, functions: T): ApiClient<T> {
  const client = {} as Record<string, (input?: any) => Promise<Response>>;

  for (const [name, def] of Object.entries(functions)) {
    client[name] = async (input?: { params?: Record<string, string>; body?: unknown }) => {
      const url = buildUrl(baseUrl, def.config.route, input?.params ?? {});
      const body = input?.body;

      return fetch(url, {
        method: def.config.method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };
  }

  return client as ApiClient<T>;
}
