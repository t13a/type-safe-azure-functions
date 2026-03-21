import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  combineMiddleware,
  createContextKey,
  createLocals,
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

describe("createContextKey / createLocals", () => {
  it("stores and retrieves typed values", () => {
    const key = createContextKey<{ name: string }>("user");
    const locals = createLocals();
    locals.set(key, { name: "Alice" });
    expect(locals.get(key)).toEqual({ name: "Alice" });
  });

  it("has() returns false before set, true after", () => {
    const key = createContextKey<number>("count");
    const locals = createLocals();
    expect(locals.has(key)).toBe(false);
    locals.set(key, 42);
    expect(locals.has(key)).toBe(true);
  });

  it("throws on get for unset key", () => {
    const key = createContextKey<string>("missing");
    const locals = createLocals();
    expect(() => locals.get(key)).toThrow("Context key not set");
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
    const custom = (async (_req, _ctx, next, _locals) => {
      await next(_req, _ctx);
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
      handler: async (_req, _ctx, parsed) => ({ jsonBody: parsed }),
    });
    expect(def.parser).toBe(schema);
  });
});

describe("defaultMiddleware", () => {
  it("passes through handler result on success", async () => {
    const expected = { jsonBody: { ok: true } };
    const next: HttpMiddlewareNext = async () => expected;
    const locals = createLocals();
    const result = await defaultMiddleware(mockRequest(), mockContext(), next, locals);
    // defaultMiddleware returns void on success (result comes via side-channel)
    expect(result).toBeUndefined();
  });

  it("returns 400 for ZodError", async () => {
    const schema = z.object({ x: z.number() });
    const next: HttpMiddlewareNext = async () => {
      schema.parse({ x: "not a number" });
      return {};
    };
    const locals = createLocals();
    const result = await defaultMiddleware(mockRequest(), mockContext(), next, locals);
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
    expect((result as any).jsonBody.error).toBeDefined();
  });

  it("returns 400 for SyntaxError", async () => {
    const next: HttpMiddlewareNext = async () => {
      throw new SyntaxError("Unexpected token");
    };
    const locals = createLocals();
    const result = await defaultMiddleware(mockRequest(), mockContext(), next, locals);
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("returns 500 for unknown errors", async () => {
    const next: HttpMiddlewareNext = async () => {
      throw new Error("boom");
    };
    const ctx = mockContext();
    const locals = createLocals();
    const result = await defaultMiddleware(mockRequest(), ctx, next, locals);
    expect(result).toMatchObject({ status: 500, jsonBody: { message: "Internal Server Error" } });
    expect(ctx.error).toHaveBeenCalled();
  });
});

describe("combineMiddleware", () => {
  it("executes middlewares in order and calls next", async () => {
    const order: number[] = [];
    const m1 = (async (_req, _ctx, next, _locals) => {
      order.push(1);
      await next(_req, _ctx);
    }) satisfies HttpMiddleware;
    const m2 = (async (_req, _ctx, next, _locals) => {
      order.push(2);
      await next(_req, _ctx);
    }) satisfies HttpMiddleware;

    const combined = combineMiddleware([m1, m2]);
    const locals = createLocals();
    const next: HttpMiddlewareNext = async () => {
      order.push(3);
      return { jsonBody: "done" };
    };
    await combined(mockRequest(), mockContext(), next, locals);
    expect(order).toEqual([1, 2, 3]);
  });

  it("short-circuits when middleware returns a response", async () => {
    const blocker = (async (_req, _ctx, _next, _locals) => {
      return { status: 403 as const, jsonBody: { message: "Forbidden" } };
    }) satisfies HttpMiddleware;
    const shouldNotRun = vi.fn();
    const m2 = (async (_req, _ctx, next, _locals) => {
      shouldNotRun();
      await next(_req, _ctx);
    }) satisfies HttpMiddleware;

    const combined = combineMiddleware([blocker, m2]);
    const locals = createLocals();
    const next: HttpMiddlewareNext = async () => ({ jsonBody: "should not reach" });
    const result = await combined(mockRequest(), mockContext(), next, locals);
    expect(result).toMatchObject({ status: 403 });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });

  it("shares locals across middlewares", async () => {
    const key = createContextKey<string>("role");
    const m1 = (async (_req, _ctx, next, locals) => {
      locals.set(key, "admin");
      await next(_req, _ctx);
    }) satisfies HttpMiddleware;
    const m2 = (async (_req, _ctx, next, locals) => {
      expect(locals.get(key)).toBe("admin");
      await next(_req, _ctx);
    }) satisfies HttpMiddleware;

    const combined = combineMiddleware([m1, m2]);
    const locals = createLocals();
    const next: HttpMiddlewareNext = async () => ({ jsonBody: "ok" });
    await combined(mockRequest(), mockContext(), next, locals);
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
      handler: async (_req, _ctx, parsed) => ({
        jsonBody: { greeting: `Hello ${parsed.name}` },
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
      handler: async (_req, _ctx, parsed) => ({ jsonBody: parsed }),
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
      handler: async (_req, _ctx, parsed) => ({ jsonBody: parsed }),
    });

    registerHttpAll(app, { parse: def });
    const handler = registered.get("parse")!.handler;
    // mockRequest with undefined body throws SyntaxError from json()
    const result = await handler(mockRequest(undefined), mockContext());
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("propagates locals from middleware to handler", async () => {
    const key = createContextKey<string>("tenant");
    const setTenant = (async (_req, _ctx, next, locals) => {
      locals.set(key, "acme");
      await next(_req, _ctx);
    }) satisfies HttpMiddleware;

    const { app, registered } = mockApp();
    const def = defineHttp({
      middleware: combineMiddleware([setTenant, defaultMiddleware]),
      handler: async (_req, _ctx, _parsed, locals) => ({
        jsonBody: { tenant: locals.get(key) },
      }),
    });

    registerHttpAll(app, { tenanted: def });
    const handler = registered.get("tenanted")!.handler;
    const result = await handler(mockRequest(), mockContext());
    expect(result).toEqual({ jsonBody: { tenant: "acme" } });
  });

  it("returns middleware error response without calling handler", async () => {
    const handlerSpy = vi.fn();
    const blocker = (async (_req, _ctx, _next, _locals) => {
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
