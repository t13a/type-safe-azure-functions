import type { HttpFunctionDefinition } from "@my-app/api";
import type { z } from "zod";

type ExtractResponse<T> =
  T extends HttpFunctionDefinition<any, infer R>
    ? R extends { status: infer S extends number; body: infer B }
      ? Omit<Response, "json"> & { status: S; json(): Promise<B> }
      : never
    : never;

type ClientInput<P> = (P extends { query: infer Q extends z.ZodTypeAny }
  ? {} extends z.input<Q>
    ? { query?: z.input<Q> }
    : { query: z.input<Q> }
  : {}) &
  (P extends { body: infer B extends z.ZodTypeAny }
    ? { body: z.input<B> }
    : {}) & { headers?: HeadersInit };

type ClientMethod<T> =
  T extends HttpFunctionDefinition<infer P, any>
    ? {} extends ClientInput<P>
      ? (input?: ClientInput<P>) => Promise<ExtractResponse<T>>
      : (input: ClientInput<P>) => Promise<ExtractResponse<T>>
    : never;

type Client<T> = {
  [K in keyof T]: T[K] extends HttpFunctionDefinition<any, any>
    ? ClientMethod<T[K]>
    : T[K] extends Record<string, any>
      ? Client<T[K]>
      : never;
};

export function createHttpFunctionClient<T extends Record<string, any>>(
  baseUrl: string,
  pathPrefix = "/api",
): Client<T> {
  const fn = async (input?: {
    query?: Record<string, string | undefined>;
    body?: unknown;
    headers?: HeadersInit;
  }) => {
    const url = new URL(`${baseUrl}${pathPrefix}`);
    if (input?.query) {
      for (const [k, v] of Object.entries(input.query)) {
        if (v !== undefined) url.searchParams.set(k, v);
      }
    }

    const lastSegment = pathPrefix.split("/").at(-1) ?? "";
    if (lastSegment.startsWith("get")) {
      return fetch(url.toString(), {
        method: "GET",
        headers: new Headers(input?.headers),
      });
    } else {
      const headers = new Headers({ "Content-Type": "application/json" });
      new Headers(input?.headers).forEach((v, k) => headers.set(k, v));
      return fetch(url.toString(), {
        method: "POST",
        headers,
        body: JSON.stringify(input?.body ?? {}),
      });
    }
  };

  return new Proxy(fn as unknown as Client<T>, {
    get(target, prop: string | symbol) {
      if (typeof prop !== "string") return Reflect.get(target, prop);
      if (prop === "then") return undefined;
      const path = pathPrefix ? `${pathPrefix}/${prop}` : prop;
      return createHttpFunctionClient(baseUrl, path);
    },
  });
}
