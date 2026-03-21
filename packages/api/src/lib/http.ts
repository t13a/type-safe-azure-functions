import {
  type app as App,
  type HttpFunctionOptions,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";

declare const ResponseType: unique symbol;

export type ParsedHttpHandler<
  TParser extends z.ZodTypeAny = z.ZodVoid,
  TReturn extends HttpResponseInit = HttpResponseInit
> = (
  request: HttpRequest,
  context: InvocationContext,
  parsed: z.infer<TParser>,
) => Promise<TReturn>;

export interface HttpFunctionDefinition<
  TParser extends z.ZodTypeAny | undefined,
  TResponse,
> {
  options: Omit<HttpFunctionOptions, "handler" | "methods" | "route">;
  parser: TParser;
  handler: ParsedHttpHandler<TParser extends z.ZodTypeAny ? TParser : z.ZodVoid>;
  [ResponseType]: TResponse;
}

type ExtractStatus<T> = T extends { status: infer S extends number } ? S : 200;

type ExtractBody<T> = T extends { jsonBody: infer J }
  ? J
  : T extends { body: any }
    ? unknown
    : void;

type ExtractResponse<T> = T extends any
  ? { status: ExtractStatus<T>; body: ExtractBody<T> }
  : never;

type DefaultErrorResponse =
  | { status: 400; body: { message: string; errors: z.typeToFlattenedError<any> } }
  | { status: 500; body: { message: string } };

export function defineHttp<
  const TOptions extends Omit<HttpFunctionOptions, "handler" | "methods" | "route">,
  TParser extends z.ZodTypeAny = z.ZodVoid,
  TReturn extends HttpResponseInit = HttpResponseInit,
>(
  options: TOptions & {
    parser?: TParser;
    handler: ParsedHttpHandler<TParser, TReturn>;
  },
): HttpFunctionDefinition<TParser extends z.ZodVoid ? undefined : TParser, ExtractResponse<TReturn> | DefaultErrorResponse> {
  const { handler, parser, ...rest } = options as any;
  return {
    options: rest,
    parser: parser ?? undefined,
    handler,
  } as any;
}

export type HttpFunctionDefinitionTree = {
  [key: string]: HttpFunctionDefinition<any, any> | HttpFunctionDefinitionTree;
};

function isDefinition(value: unknown): value is HttpFunctionDefinition<any, any> {
  return typeof value === "object" && value !== null && "handler" in value;
}

export function registerHttp(
  app: typeof App, name: string, route: string, def: HttpFunctionDefinition<any, any>
): void {
  app.http(name, {
    ...def.options,
    methods: ["POST"],
    route,
    handler: async (
      request: HttpRequest,
      context: InvocationContext,
    ): Promise<HttpResponseInit> => {
      try {
        let parsed: unknown = undefined;
        if (def.parser) {
          const raw = await request.json();
          parsed = def.parser.parse(raw);
        }

        return await def.handler(request, context, parsed as any);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return { status: 400, jsonBody: { message: "Bad Request", errors: error.flatten() } };
        }
        context.error("Internal Server Error", error);
        return { status: 500, jsonBody: { message: "Internal Server Error" } };
      }
    },
  });
}

export function registerHttpAll(
  app: typeof App,
  tree: HttpFunctionDefinitionTree,
  routePrefix = "",
  namePrefix = "",
): void {
  for (const [key, value] of Object.entries(tree)) {
    const route = routePrefix ? `${routePrefix}/${key}` : key;
    const name = namePrefix ? `${namePrefix}-${key}` : key;
    if (isDefinition(value)) {
      registerHttp(app, name, route, value);
    } else {
      registerHttpAll(app, value as HttpFunctionDefinitionTree, route, name);
    }
  }
}
