import { z } from "zod";

export interface RouteDefinition<
  TMethod extends string,
  TPath extends string,
  TParams extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
> {
  method: TMethod;
  route: TPath;
  params: TParams;
  body: TBody;
  response: TResponse;
}

export function defineRoute<
  TMethod extends string,
  TPath extends string,
  TParams extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
>(def: RouteDefinition<TMethod, TPath, TParams, TBody, TResponse>) {
  return def;
}

export type InferParams<R> =
  R extends RouteDefinition<any, any, infer P, any, any> ? z.infer<P> : never;
export type InferBody<R> =
  R extends RouteDefinition<any, any, any, infer B, any> ? z.infer<B> : never;
export type InferResponse<R> =
  R extends RouteDefinition<any, any, any, any, infer Res>
    ? z.infer<Res>
    : never;
