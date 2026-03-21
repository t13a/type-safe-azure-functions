import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import type { HttpMiddleware, HttpMiddlewareNext } from "./http.js";

type ExtractMiddlewareReturn<T> =
  T extends (...args: any[]) => Promise<infer R>
    ? Exclude<R, void | undefined>
    : never;

export function combineMiddleware<const T extends readonly HttpMiddleware<any>[]>(
  middlewares: [...T],
): HttpMiddleware<ExtractMiddlewareReturn<T[number]>> {
  return ((request: HttpRequest, context: InvocationContext, next: HttpMiddlewareNext) => {
    const dispatch = (i: number) =>
      async (req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> => {
        if (i >= middlewares.length) return next(req, ctx);
        let innerResult: HttpResponseInit | undefined;
        const innerNext = async (r: HttpRequest, c: InvocationContext) => {
          innerResult = await dispatch(i + 1)(r, c);
          return innerResult;
        };
        const mwResult = await middlewares[i](req, ctx, innerNext);
        return (mwResult ?? innerResult)!;
      };
    return dispatch(0)(request, context);
  }) as HttpMiddleware<ExtractMiddlewareReturn<T[number]>>;
}
