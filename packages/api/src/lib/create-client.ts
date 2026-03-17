import type { FunctionDefinition } from "./define-function.js";
import { z } from "zod";

type InferResponse<T> = T extends FunctionDefinition<any, infer R> ? R : never;

export interface TypedResponse<T> extends Response {
  json(): Promise<T>;
}

type NeedsMethod<C> = C extends { methods: [any] }
  ? {}
  : { method: C extends { methods: ReadonlyArray<infer M> } ? M : string };

type ClientInput<T> = T extends FunctionDefinition<infer C, any>
  ? NeedsMethod<C> &
      (z.infer<C["parse"]["params"]> extends Record<string, never>
        ? {}
        : { params: z.infer<C["parse"]["params"]> }) &
      (C["parse"]["body"] extends z.ZodVoid
        ? {}
        : { body: z.input<C["parse"]["body"]> })
  : never;

type ClientMethod<T> = keyof ClientInput<T> extends never
  ? () => Promise<TypedResponse<InferResponse<T>>>
  : (input: ClientInput<T>) => Promise<TypedResponse<InferResponse<T>>>;

type Client<T extends Record<string, FunctionDefinition<any, any>>> = {
  [K in keyof T]: ClientMethod<T[K]>;
};

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

export function createClient<
  T extends Record<string, FunctionDefinition<any, any>>,
>(baseUrl: string, functions: T): Client<T> {
  const client = {} as Record<string, (input?: any) => Promise<Response>>;

  for (const [name, def] of Object.entries(functions)) {
    client[name] = async (input?: { method?: string; params?: Record<string, string>; body?: unknown }) => {
      const url = buildUrl(baseUrl, def.config.route, input?.params ?? {});
      const body = input?.body;
      const method = input?.method ?? def.config.methods[0];

      return fetch(url, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };
  }

  return client as Client<T>;
}
