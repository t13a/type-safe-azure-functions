import type { HttpFunctionDefinition } from "@my-app/api";
import type { z } from "zod";

type TypedResponse<T> =
  T extends HttpFunctionDefinition<any, infer R>
    ? R extends { status: infer S extends number; body: infer B; }
      ? Omit<Response, "json"> & { status: S; json(): Promise<B> }
      : never
    : never;

type HttpFunctionClientMethod<T> = T extends HttpFunctionDefinition<infer P, any>
  ? P extends z.ZodTypeAny
    ? (input: { body: z.input<P>; headers?: HeadersInit }) => Promise<TypedResponse<T>>
    : (input?: { headers?: HeadersInit }) => Promise<TypedResponse<T>>
  : never;

function normalizeHeaders(init?: HeadersInit): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) return Object.fromEntries(init.entries());
  if (Array.isArray(init)) return Object.fromEntries(init);
  return init;
}

type HttpFunctionClient<T> = {
  [K in keyof T]: T[K] extends HttpFunctionDefinition<any, any>
    ? HttpFunctionClientMethod<T[K]>
    : T[K] extends Record<string, any>
      ? HttpFunctionClient<T[K]>
      : never;
};

export function createHttpFunctionClient<
  T extends Record<string, any>,
>(baseUrl: string, pathPrefix = ""): HttpFunctionClient<T> {
  return new Proxy({} as HttpFunctionClient<T>, {
    get(_, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      if (prop === "then") return undefined;
      const path = pathPrefix ? `${pathPrefix}/${prop}` : prop;

      const fn = async (input?: { body?: unknown; headers?: HeadersInit }) => {
        return fetch(`${baseUrl}/api/${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...normalizeHeaders(input?.headers),
          },
          body: JSON.stringify(input?.body ?? {}),
        });
      };

      return new Proxy(fn, {
        get(target, innerProp: string | symbol) {
          if (typeof innerProp !== "string") return Reflect.get(target, innerProp);
          if (innerProp === "then") return undefined;
          return createHttpFunctionClient(baseUrl, path)[innerProp];
        },
      });
    },
  });
}
