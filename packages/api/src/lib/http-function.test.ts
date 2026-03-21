import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  combineMiddleware,
  createVariableKey,
  createVars,
  defaultMiddleware,
  defineHttp,
  registerHttpAll,
  type HttpMiddleware,
  type HttpMiddlewareNext,
} from "./http-function.js";
import type {
  app as App,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// Test helpers

function mockRequest(body?: unknown, headers?: Record<string, string>): HttpRequest {
  return {
    json: body === undefined
      ? async () => { throw new SyntaxError("Unexpected end of JSON input"); }
      : async () => body,
    headers: new Headers(headers),
  } as unknown as HttpRequest;
}

function mockContext(): InvocationContext {
  return {
    log: vi.fn(),
    error: vi.fn(),
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

describe("createVariableKey / createVars", () => {
  it("stores and retrieves typed values", () => {
    const key = createVariableKey<{ name: string }>("user");
    const vars = createVars();
    vars.set(key, { name: "Alice" });
    expect(vars.get(key)).toEqual({ name: "Alice" });
  });

  it("returns undefined for unset key", () => {
    const key = createVariableKey<string>("missing");
    const vars = createVars();
    expect(vars.get(key)).toBeUndefined();
  });
});

describe("defineHttp", () => {
  it("uses defaultMiddleware when no middleware specified", () => {
    const def = defineHttp({
      handler: async () => ({ jsonBody: "ok" }),
    });
    expect(def.middleware).toBe(defaultMiddleware);
    expect(def.parser).toBeUndefined();
  });

  it("stores custom middleware", () => {
    const custom = (async (c) => {
      await c.next();
    }) satisfies HttpMiddleware;

    const def = defineHttp({
      middleware: custom,
      handler: async () => ({ jsonBody: "ok" }),
    });
    expect(def.middleware).toBe(custom);
  });

  it("stores parser when provided", () => {
    const schema = z.object({ x: z.number() });
    const def = defineHttp({
      parser: schema,
      handler: async (c) => ({ jsonBody: c.parsed }),
    });
    expect(def.parser).toBe(schema);
  });
});

describe("defaultMiddleware", () => {
  it("passes through handler result on success", async () => {
    const expected = { jsonBody: { ok: true } };
    const next: HttpMiddlewareNext = async () => expected;
    const vars = createVars();
    const result = await defaultMiddleware({ request: mockRequest(), context: mockContext(), vars, next });
    // defaultMiddleware returns void on success (result comes via side-channel)
    expect(result).toBeUndefined();
  });

  it("returns 400 for ZodError", async () => {
    const schema = z.object({ x: z.number() });
    const next: HttpMiddlewareNext = async () => {
      schema.parse({ x: "not a number" });
      return {};
    };
    const vars = createVars();
    const result = await defaultMiddleware({ request: mockRequest(), context: mockContext(), vars, next });
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
    expect((result as any).jsonBody.error).toBeDefined();
  });

  it("returns 400 for SyntaxError", async () => {
    const next: HttpMiddlewareNext = async () => {
      throw new SyntaxError("Unexpected token");
    };
    const vars = createVars();
    const result = await defaultMiddleware({ request: mockRequest(), context: mockContext(), vars, next });
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("returns 500 for unknown errors", async () => {
    const next: HttpMiddlewareNext = async () => {
      throw new Error("boom");
    };
    const ctx = mockContext();
    const vars = createVars();
    const result = await defaultMiddleware({ request: mockRequest(), context: ctx, vars, next });
    expect(result).toMatchObject({ status: 500, jsonBody: { message: "Internal Server Error" } });
    expect(ctx.error).toHaveBeenCalled();
  });
});

describe("combineMiddleware", () => {
  it("executes middlewares in order and calls next", async () => {
    const order: number[] = [];
    const m1 = (async (c) => {
      order.push(1);
      await c.next();
    }) satisfies HttpMiddleware;
    const m2 = (async (c) => {
      order.push(2);
      await c.next();
    }) satisfies HttpMiddleware;

    const combined = combineMiddleware([m1, m2]);
    const vars = createVars();
    const next: HttpMiddlewareNext = async () => {
      order.push(3);
      return { jsonBody: "done" };
    };
    await combined({ request: mockRequest(), context: mockContext(), vars, next });
    expect(order).toEqual([1, 2, 3]);
  });

  it("short-circuits when middleware returns a response", async () => {
    const blocker = (async (_c) => {
      return { status: 403 as const, jsonBody: { message: "Forbidden" } };
    }) satisfies HttpMiddleware;
    const shouldNotRun = vi.fn();
    const m2 = (async (c) => {
      shouldNotRun();
      await c.next();
    }) satisfies HttpMiddleware;

    const combined = combineMiddleware([blocker, m2]);
    const vars = createVars();
    const next: HttpMiddlewareNext = async () => ({ jsonBody: "should not reach" });
    const result = await combined({ request: mockRequest(), context: mockContext(), vars, next });
    expect(result).toMatchObject({ status: 403 });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });

  it("shares vars across middlewares", async () => {
    const key = createVariableKey<string>("role");
    const m1 = (async (c) => {
      c.vars.set(key, "admin");
      await c.next();
    }) satisfies HttpMiddleware;
    const m2 = (async (c) => {
      expect(c.vars.get(key)).toBe("admin");
      await c.next();
    }) satisfies HttpMiddleware;

    const combined = combineMiddleware([m1, m2]);
    const vars = createVars();
    const next: HttpMiddlewareNext = async () => ({ jsonBody: "ok" });
    await combined({ request: mockRequest(), context: mockContext(), vars, next });
  });
});

describe("registerHttpAll", () => {
  it("registers flat definitions with correct routes and names", () => {
    const { app, registered } = mockApp();
    const def1 = defineHttp({ handler: async () => ({ jsonBody: "a" }) });
    const def2 = defineHttp({ handler: async () => ({ jsonBody: "b" }) });

    registerHttpAll(app, { foo: def1, bar: def2 });

    expect(registered.size).toBe(2);
    expect(registered.get("foo")?.route).toBe("foo");
    expect(registered.get("bar")?.route).toBe("bar");
    expect(registered.get("foo")?.methods).toEqual(["POST"]);
  });

  it("does not confuse a nested tree key named 'handler' with a definition", () => {
    const { app, registered } = mockApp();
    const leaf = defineHttp({ handler: async () => ({ jsonBody: "leaf" }) });

    registerHttpAll(app, {
      handler: leaf,
    });

    expect(registered.size).toBe(1);
    expect(registered.get("handler")?.route).toBe("handler");
  });

  it("registers nested definitions with prefixed routes and names", () => {
    const { app, registered } = mockApp();
    const leaf = defineHttp({ handler: async () => ({ jsonBody: "leaf" }) });

    registerHttpAll(app, {
      admin: { stats: leaf },
    });

    expect(registered.size).toBe(1);
    expect(registered.get("admin-stats")?.route).toBe("admin/stats");
  });
});

describe("handler integration", () => {
  it("parses body with parser and passes to handler", async () => {
    const { app, registered } = mockApp();
    const def = defineHttp({
      parser: z.object({ name: z.string() }),
      handler: async (c) => ({
        jsonBody: { greeting: `Hello ${c.parsed.name}` },
      }),
    });

    registerHttpAll(app, { greet: def });
    const handler = registered.get("greet")!.handler;
    const result = await handler(mockRequest({ name: "World" }), mockContext());
    expect(result).toEqual({ jsonBody: { greeting: "Hello World" } });
  });

  it("returns handler result when no parser", async () => {
    const { app, registered } = mockApp();
    const def = defineHttp({
      handler: async () => ({ jsonBody: { ok: true } }),
    });

    registerHttpAll(app, { health: def });
    const handler = registered.get("health")!.handler;
    const result = await handler(mockRequest(), mockContext());
    expect(result).toEqual({ jsonBody: { ok: true } });
  });

  it("returns 400 when body fails validation", async () => {
    const { app, registered } = mockApp();
    const def = defineHttp({
      parser: z.object({ count: z.number() }),
      handler: async (c) => ({ jsonBody: c.parsed }),
    });

    registerHttpAll(app, { nums: def });
    const handler = registered.get("nums")!.handler;
    const result = await handler(mockRequest({ count: "nope" }), mockContext());
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("returns 400 when body is not valid JSON", async () => {
    const { app, registered } = mockApp();
    const def = defineHttp({
      parser: z.object({ x: z.number() }),
      handler: async (c) => ({ jsonBody: c.parsed }),
    });

    registerHttpAll(app, { parse: def });
    const handler = registered.get("parse")!.handler;
    // mockRequest with undefined body throws SyntaxError from json()
    const result = await handler(mockRequest(undefined), mockContext());
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("propagates vars from middleware to handler", async () => {
    const key = createVariableKey<string>("tenant");
    const setTenant = (async (c) => {
      c.vars.set(key, "acme");
      await c.next();
    }) satisfies HttpMiddleware;

    const { app, registered } = mockApp();
    const def = defineHttp({
      middleware: combineMiddleware([setTenant, defaultMiddleware]),
      handler: async (c) => ({
        jsonBody: { tenant: c.vars.get(key) },
      }),
    });

    registerHttpAll(app, { tenanted: def });
    const handler = registered.get("tenanted")!.handler;
    const result = await handler(mockRequest(), mockContext());
    expect(result).toEqual({ jsonBody: { tenant: "acme" } });
  });

  it("returns middleware error response without calling handler", async () => {
    const handlerSpy = vi.fn();
    const blocker = (async (_c) => {
      return { status: 401 as const, jsonBody: { message: "No" } };
    }) satisfies HttpMiddleware;

    const { app, registered } = mockApp();
    const def = defineHttp({
      middleware: blocker,
      handler: async () => {
        handlerSpy();
        return { jsonBody: "never" };
      },
    });

    registerHttpAll(app, { blocked: def });
    const handler = registered.get("blocked")!.handler;
    const result = await handler(mockRequest(), mockContext());
    expect(result).toMatchObject({ status: 401 });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
