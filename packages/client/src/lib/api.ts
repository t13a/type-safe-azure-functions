import type { HttpFunctionDefinition } from "@my-app/api";
import type { z } from "zod";

type InferResponse<T> =
  T extends HttpFunctionDefinition<any, infer R> ? R : never;

type TypedResponse<TResponse> = TResponse extends {
  status: infer S extends number;
  body: infer B;
}
  ? Omit<Response, "json"> & { status: S; json(): Promise<B> }
  : never;

type ClientMethod<T> = T extends HttpFunctionDefinition<
  infer P extends { body: z.ZodTypeAny; headers: z.ZodTypeAny },
  any
>
  ? P["body"] extends z.ZodVoid
    ? (input?: { headers?: HeadersInit }) => Promise<TypedResponse<InferResponse<T>>>
    : (input: { body: z.input<P["body"]>; headers?: HeadersInit }) => Promise<TypedResponse<InferResponse<T>>>
  : never;

function normalizeHeaders(init?: HeadersInit): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) return Object.fromEntries(init.entries());
  if (Array.isArray(init)) return Object.fromEntries(init);
  return init;
}

type Client<T extends Record<string, HttpFunctionDefinition<any, any>>> = {
  [K in keyof T]: ClientMethod<T[K]>;
};

export function createClient<
  T extends Record<string, HttpFunctionDefinition<any, any>>,
>(baseUrl: string): Client<T> {
  return new Proxy({} as Client<T>, {
    get(_, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      return async (input?: { body?: unknown; headers?: HeadersInit }) => {
        return fetch(`${baseUrl}/api/${prop}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...normalizeHeaders(input?.headers),
          },
          body: JSON.stringify(input?.body ?? {}),
        });
      };
    },
  });
}
