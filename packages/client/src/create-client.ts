import type { FunctionDefinition } from "@my-app/api";
import type { z } from "zod";

type InferStatus<T> =
  T extends FunctionDefinition<any, { status: infer S extends number; body: any }> ? S : never;
type InferBody<T> =
  T extends FunctionDefinition<any, { status: any; body: infer B }> ? B : never;

type TypedResponse<TStatus extends number, TBody> =
  | (Omit<Response, "json"> & { status: TStatus; json(): Promise<TBody> })
  | (Omit<Response, "json"> & {
      status: 400;
      json(): Promise<{ errors: { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> } }>;
    })
  | (Omit<Response, "json"> & {
      status: 500;
      json(): Promise<{ error: string }>;
    });

type ClientMethod<T> = T extends FunctionDefinition<
  infer C extends { parse: { body: z.ZodTypeAny } },
  any
>
  ? C["parse"]["body"] extends z.ZodVoid
    ? () => Promise<TypedResponse<InferStatus<T>, InferBody<T>>>
    : (input: { body: z.input<C["parse"]["body"]> }) => Promise<TypedResponse<InferStatus<T>, InferBody<T>>>
  : never;

type Client<T extends Record<string, FunctionDefinition<any, any>>> = {
  [K in keyof T]: ClientMethod<T[K]>;
};

export function createClient<
  T extends Record<string, FunctionDefinition<any, any>>,
>(baseUrl: string): Client<T> {
  return new Proxy({} as Client<T>, {
    get(_, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      return async (input?: { body?: unknown }) => {
        return fetch(`${baseUrl}/api/${prop}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input?.body ?? {}),
        });
      };
    },
  });
}
