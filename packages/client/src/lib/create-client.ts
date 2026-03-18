import type { FunctionDefinition, badRequest, internalServerError } from "@my-app/api";
import type { z } from "zod";

type InferStatus<T> =
  T extends FunctionDefinition<any, { status: infer S extends number; body: any }> ? S : never;
type InferBody<T> =
  T extends FunctionDefinition<any, { status: any; body: infer B }> ? B : never;

type TypedResponse<TStatus extends number, TBody> =
  | (Omit<Response, "json"> & { status: TStatus; json(): Promise<TBody> })
  | (Omit<Response, "json"> & { status: 400; json(): Promise<ReturnType<typeof badRequest>["jsonBody"]> })
  | (Omit<Response, "json"> & { status: 500; json(): Promise<ReturnType<typeof internalServerError>["jsonBody"]> });

type ClientMethod<T> = T extends FunctionDefinition<
  infer C extends { parse: { body: z.ZodTypeAny; headers: z.ZodTypeAny } },
  any
>
  ? C["parse"]["body"] extends z.ZodVoid
    ? (input?: { headers?: HeadersInit }) => Promise<TypedResponse<InferStatus<T>, InferBody<T>>>
    : (input: { body: z.input<C["parse"]["body"]>; headers?: HeadersInit }) => Promise<TypedResponse<InferStatus<T>, InferBody<T>>>
  : never;

function normalizeHeaders(init?: HeadersInit): Record<string, string> {
  if (!init) return {};
  if (init instanceof Headers) return Object.fromEntries(init.entries());
  if (Array.isArray(init)) return Object.fromEntries(init);
  return init;
}

type Client<T extends Record<string, FunctionDefinition<any, any>>> = {
  [K in keyof T]: ClientMethod<T[K]>;
};

export function createClient<
  T extends Record<string, FunctionDefinition<any, any>>,
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
