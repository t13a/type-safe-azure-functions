import { describe, expect, it } from "vitest";
import { z } from "zod";
import { http, registerAll } from "./core.js";
import type {
  app as App,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// Test helpers

function mockRequest(body?: unknown, query?: Record<string, string>): HttpRequest {
  return {
    json: body === undefined
      ? async () => { throw new SyntaxError("Unexpected end of JSON input"); }
      : async () => body,
    headers: new Headers(),
    query: new URLSearchParams(query ?? {}),
  } as unknown as HttpRequest;
}

function mockContext(): InvocationContext {
  return {
    log: () => {},
    error: () => {},
  } as unknown as InvocationContext;
}

function mockApp() {
  const registered = new Map<string, {
    route: string;
    handler: (req: HttpRequest, ctx: InvocationContext) => Promise<HttpResponseInit>;
    methods: string[];
  }>();
  const app = {
    http: (name: string, options: any) => {
      registered.set(name, {
        route: options.route,
        handler: options.handler,
        methods: options.methods,
      });
    },
  } as unknown as typeof App;
  return { app, registered };
}

// Tests

describe("http", () => {
  it("creates a definition without parser", () => {
    const def = http({
      handler: async () => ({ jsonBody: "ok" }),
    });
    expect(def.parser).toBeUndefined();
    expect(def.handler).toBeTypeOf("function");
  });

  it("stores parser when provided", () => {
    const schema = z.object({ x: z.number() });
    const def = http({
      parser: { body: schema },
      handler: async (request, context, parser) => ({ jsonBody: "ok" }),
    });
    expect(def.parser).toEqual({ body: schema });
  });

  it("stores Azure Functions options", () => {
    const def = http({
      authLevel: "anonymous",
      handler: async () => ({ jsonBody: "ok" }),
    });
    expect(def.options).toEqual({ authLevel: "anonymous" });
  });
});

describe("registerAll", () => {
  it("registers flat definitions with correct routes and names", () => {
    const { app, registered } = mockApp();
    const def1 = http({ handler: async () => ({ jsonBody: "a" }) });
    const def2 = http({ handler: async () => ({ jsonBody: "b" }) });

    registerAll(app, { foo: def1, bar: def2 });

    expect(registered.size).toBe(2);
    expect(registered.get("foo")?.route).toBe("foo");
    expect(registered.get("bar")?.route).toBe("bar");
    expect(registered.get("foo")?.methods).toEqual(["POST"]);
  });

  it("registers GET for keys starting with 'get'", () => {
    const { app, registered } = mockApp();
    const def = http({ handler: async () => ({ jsonBody: "ok" }) });

    registerAll(app, { getTodos: def });

    expect(registered.get("getTodos")?.methods).toEqual(["GET"]);
  });

  it("registers GET for nested keys starting with 'get'", () => {
    const { app, registered } = mockApp();
    const def = http({ handler: async () => ({ jsonBody: "ok" }) });

    registerAll(app, { management: { getStats: def } });

    expect(registered.get("management-getStats")?.methods).toEqual(["GET"]);
    expect(registered.get("management-getStats")?.route).toBe("management/getStats");
  });

  it("registers POST for non-get keys", () => {
    const { app, registered } = mockApp();
    const def = http({ handler: async () => ({ jsonBody: "ok" }) });

    registerAll(app, { createTodo: def, listTodos: def });

    expect(registered.get("createTodo")?.methods).toEqual(["POST"]);
    expect(registered.get("listTodos")?.methods).toEqual(["POST"]);
  });

  it("registers nested definitions via subRoute with prefixed routes and names", () => {
    const { app, registered } = mockApp();
    const leaf = http({ handler: async () => ({ jsonBody: "leaf" }) });

    registerAll(app, {
      admin: { stats: leaf },
    });

    expect(registered.size).toBe(1);
    expect(registered.get("admin-stats")?.route).toBe("admin/stats");
  });

  it("handles deeply nested subRoutes", () => {
    const { app, registered } = mockApp();
    const leaf = http({ handler: async () => ({ jsonBody: "deep" }) });

    registerAll(app, {
      a: { b: { c: leaf } },
    });

    expect(registered.size).toBe(1);
    expect(registered.get("a-b-c")?.route).toBe("a/b/c");
  });

  it("calls handler with (request, context, parser)", async () => {
    const { app, registered } = mockApp();
    const bodySchema = z.object({ x: z.number() });
    const parserDef = { body: bodySchema };
    const def = http({
      parser: parserDef,
      handler: async (request, context, parser) => {
        return { jsonBody: { parser: parser === parserDef } };
      },
    });

    registerAll(app, { test: def });
    const handler = registered.get("test")!.handler;
    const result = await handler(mockRequest(), mockContext());
    expect(result).toEqual({ jsonBody: { parser: true } });
  });
});
