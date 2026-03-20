import {
  type app as App,
  type HttpFunctionOptions,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";

declare const ResponseType: unique symbol;

export type HttpRequestParser = {
  headers?: z.ZodTypeAny;
  body?: z.ZodTypeAny;
};

export type ParsedHttpRequest<TParser extends HttpRequestParser> = {
  headers: TParser extends { headers: infer H extends z.ZodTypeAny } ? z.infer<H> : void;
  body: TParser extends { body: infer B extends z.ZodTypeAny } ? z.infer<B> : void;
}

export type ParsedHttpHandler<
  TParser extends HttpRequestParser = {},
  TReturn extends HttpResponseInit = HttpResponseInit
> = (
  request: HttpRequest,
  context: InvocationContext,
  parsed: ParsedHttpRequest<TParser>,
) => Promise<TReturn>;

export type HttpErrorHandler<
  TError = unknown,
  TErrorReturn extends HttpResponseInit = HttpResponseInit
> = (
  request: HttpRequest,
  context: InvocationContext,
  error: TError,
) => Promise<TErrorReturn>;

export interface HttpFunctionDefinition<
  TParser extends Required<HttpRequestParser>,
  TResponse,
> {
  options: Omit<HttpFunctionOptions, "handler" | "methods" | "route">;
  parser: TParser;
  handler: ParsedHttpHandler<TParser>;
  errorHandler: HttpErrorHandler;
  [ResponseType]: TResponse;
}

type NormalizeParser<T> = {
  headers: T extends { headers: infer H extends z.ZodTypeAny } ? H : z.ZodVoid;
  body: T extends { body: infer B extends z.ZodTypeAny } ? B : z.ZodVoid;
};

type ExtractStatus<T> = T extends { status: infer S extends number } ? S : 200;

type ExtractBody<T> = T extends { jsonBody: infer J }
  ? J
  : T extends { body: any }
    ? unknown
    : void;

type ExtractResponse<T> = T extends any
  ? { status: ExtractStatus<T>; body: ExtractBody<T> }
  : never;

export const defaultErrorHandler = (async (_request, context, error) => {
  if (error instanceof z.ZodError) {
    return { status: 400, jsonBody: { message: "Bad Request", errors: error.flatten() } } as const;
  }
  context.error("Internal Server Error", error);
  return { status: 500, jsonBody: { message: "Internal Server Error" } } as const;
}) satisfies HttpErrorHandler;

export function defineHttp<
  const TOptions extends Omit<HttpFunctionOptions, "handler" | "methods" | "route">,
  const TParser extends HttpRequestParser = {},
  TReturn extends HttpResponseInit = HttpResponseInit,
  TErrorReturn extends HttpResponseInit = Awaited<ReturnType<typeof defaultErrorHandler>>,
>(
  options: TOptions & {
    parser?: TParser;
    handler: ParsedHttpHandler<TParser, TReturn>;
    errorHandler?: HttpErrorHandler<unknown, TErrorReturn>;
  },
): HttpFunctionDefinition<NormalizeParser<TParser>, ExtractResponse<TReturn | TErrorReturn>> {
  const { handler, errorHandler, parser, ...rest } = options as any;
  return {
    options: rest,
    parser: {
      body: parser?.body ?? z.void(),
      headers: parser?.headers ?? z.void(),
    },
    handler,
    errorHandler: errorHandler ?? defaultErrorHandler,
  } as HttpFunctionDefinition<
    NormalizeParser<TParser>,
    ExtractResponse<TReturn | TErrorReturn>
  >;
}

export function registerHttp(
  app: typeof App, name: string, def: HttpFunctionDefinition<any, any>
): void {
  app.http(name, {
    ...def.options,
    methods: ["POST"],
    route: name,
    handler: async (
      request: HttpRequest,
      context: InvocationContext,
    ): Promise<HttpResponseInit> => {
      try {
        let body: unknown = undefined;
        if (!(def.parser.body instanceof z.ZodVoid)) {
          const raw = await request.json();
          body = def.parser.body.parse(raw);
        }

        const parsed: Record<string, unknown> = { body };
        if (!(def.parser.headers instanceof z.ZodVoid)) {
          const raw = Object.fromEntries(request.headers.entries());
          parsed.headers = def.parser.headers.parse(raw);
        }

        return await def.handler(request, context, parsed as any);
      } catch (error) {
        return await def.errorHandler(request, context, error);
      }
    },
  });
}
