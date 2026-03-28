import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  combineMiddleware,
  createVariableKey,
  createVars,
  catchError,
  withCatchError,
  withMiddleware,
  type Middleware,
  type NextMiddleware,
  type MiddlewareHandler,
} from "./middleware.js";
import { http, registerAll } from "./core.js";
import type {
  app as App,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";

// Test helpers

function mockRequest(
  body?: unknown,
  headers?: Record<string, string>,
  query?: Record<string, string>,
): HttpRequest {
  return {
    json: body === undefined
      ? async () => { throw new SyntaxError("Unexpected end of JSON input"); }
      : async () => body,
    headers: new Headers(headers),
    query: new URLSearchParams(query ?? {}),
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

describe("catchError", () => {
  it("passes through handler result on success", async () => {
    const expected = { jsonBody: { ok: true } };
    const next: NextMiddleware = async () => expected;
    const vars = createVars();
    const result = await catchError({ request: mockRequest(), context: mockContext(), vars, next });
    expect(result).toBeUndefined();
  });

  it("returns 400 for ZodError", async () => {
    const schema = z.object({ x: z.number() });
    const next: NextMiddleware = async () => {
      schema.parse({ x: "not a number" });
      return {};
    };
    const vars = createVars();
    const result = await catchError({ request: mockRequest(), context: mockContext(), vars, next });
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
    expect((result as any).jsonBody.error).toBeDefined();
  });

  it("returns 400 for SyntaxError", async () => {
    const next: NextMiddleware = async () => {
      throw new SyntaxError("Unexpected token");
    };
    const vars = createVars();
    const result = await catchError({ request: mockRequest(), context: mockContext(), vars, next });
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("returns 500 for unknown errors", async () => {
    const next: NextMiddleware = async () => {
      throw new Error("boom");
    };
    const ctx = mockContext();
    const vars = createVars();
    const result = await catchError({ request: mockRequest(), context: ctx, vars, next });
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
    }) satisfies Middleware;
    const m2 = (async (c) => {
      order.push(2);
      await c.next();
    }) satisfies Middleware;

    const combined = combineMiddleware([m1, m2]);
    const vars = createVars();
    const next: NextMiddleware = async () => {
      order.push(3);
      return { jsonBody: "done" };
    };
    await combined({ request: mockRequest(), context: mockContext(), vars, next });
    expect(order).toEqual([1, 2, 3]);
  });

  it("short-circuits when middleware returns a response", async () => {
    const blocker = (async (_c) => {
      return { status: 403 as const, jsonBody: { message: "Forbidden" } };
    }) satisfies Middleware;
    const shouldNotRun = vi.fn();
    const m2 = (async (c) => {
      shouldNotRun();
      await c.next();
    }) satisfies Middleware;

    const combined = combineMiddleware([blocker, m2]);
    const vars = createVars();
    const next: NextMiddleware = async () => ({ jsonBody: "should not reach" });
    const result = await combined({ request: mockRequest(), context: mockContext(), vars, next });
    expect(result).toMatchObject({ status: 403 });
    expect(shouldNotRun).not.toHaveBeenCalled();
  });

  it("shares vars across middlewares", async () => {
    const key = createVariableKey<string>("role");
    const m1 = (async (c) => {
      c.vars.set(key, "admin");
      await c.next();
    }) satisfies Middleware;
    const m2 = (async (c) => {
      expect(c.vars.get(key)).toBe("admin");
      await c.next();
    }) satisfies Middleware;

    const combined = combineMiddleware([m1, m2]);
    const vars = createVars();
    const next: NextMiddleware = async () => ({ jsonBody: "ok" });
    await combined({ request: mockRequest(), context: mockContext(), vars, next });
  });
});

describe("withMiddleware", () => {
  it("parses body with parser and passes to handler", async () => {
    const schema = z.object({ name: z.string() });
    const parser = { body: schema };
    const handler: MiddlewareHandler<typeof parser> = async (c) => ({
      jsonBody: { greeting: `Hello ${c.parsed.body.name}` },
    });
    const wrapped = withMiddleware([catchError], handler);

    const result = await wrapped(mockRequest({ name: "World" }), mockContext(), parser);
    expect(result).toEqual({ jsonBody: { greeting: "Hello World" } });
  });

  it("parses query params with query parser", async () => {
    const schema = z.object({ completed: z.string().transform(s => s === "true").optional() });
    const parser = { query: schema };
    const handler: MiddlewareHandler<typeof parser> = async (c) => ({
      jsonBody: { completed: c.parsed.query.completed },
    });
    const wrapped = withMiddleware([catchError], handler);

    const result = await wrapped(
      mockRequest(undefined, {}, { completed: "true" }),
      mockContext(),
      parser,
    );
    expect(result).toEqual({ jsonBody: { completed: true } });
  });

  it("parses both body and query when both are provided", async () => {
    const bodySchema = z.object({ title: z.string() });
    const querySchema = z.object({ dry: z.string().optional() });
    const parser = { body: bodySchema, query: querySchema };
    const handler: MiddlewareHandler<typeof parser> = async (c) => ({
      jsonBody: { title: c.parsed.body.title, dry: c.parsed.query.dry },
    });
    const wrapped = withMiddleware([catchError], handler);

    const result = await wrapped(
      mockRequest({ title: "Hello" }, {}, { dry: "run" }),
      mockContext(),
      parser,
    );
    expect(result).toEqual({ jsonBody: { title: "Hello", dry: "run" } });
  });

  it("returns handler result when no parser", async () => {
    const wrapped = withMiddleware([catchError], async () => ({
      jsonBody: { ok: true },
    }));

    const result = await wrapped(mockRequest(), mockContext(), undefined as any);
    expect(result).toEqual({ jsonBody: { ok: true } });
  });

  it("returns 400 when body fails validation", async () => {
    const schema = z.object({ count: z.number() });
    const wrapped = withMiddleware([catchError], async (c) => ({
      jsonBody: c.parsed,
    }));

    const result = await wrapped(mockRequest({ count: "nope" }), mockContext(), { body: schema });
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("returns 400 when body is not valid JSON", async () => {
    const schema = z.object({ x: z.number() });
    const wrapped = withMiddleware([catchError], async (c) => ({
      jsonBody: c.parsed,
    }));

    const result = await wrapped(mockRequest(undefined), mockContext(), { body: schema });
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("returns 400 when query fails validation", async () => {
    const schema = z.object({ count: z.number() });
    const wrapped = withMiddleware([catchError], async (c) => ({
      jsonBody: c.parsed,
    }));

    const result = await wrapped(
      mockRequest(undefined, {}, { count: "not-a-number" }),
      mockContext(),
      { query: schema },
    );
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });

  it("propagates vars from middleware to handler", async () => {
    const key = createVariableKey<string>("tenant");
    const setTenant = (async (c) => {
      c.vars.set(key, "acme");
      await c.next();
    }) satisfies Middleware;

    const wrapped = withMiddleware([setTenant, catchError], async (c) => ({
      jsonBody: { tenant: c.vars.get(key) },
    }));

    const result = await wrapped(mockRequest(), mockContext(), undefined as any);
    expect(result).toEqual({ jsonBody: { tenant: "acme" } });
  });

  it("returns middleware error response without calling handler", async () => {
    const handlerSpy = vi.fn();
    const blocker = (async (_c) => {
      return { status: 401 as const, jsonBody: { message: "No" } };
    }) satisfies Middleware;

    const wrapped = withMiddleware([blocker], async () => {
      handlerSpy();
      return { jsonBody: "never" };
    });

    const result = await wrapped(mockRequest(), mockContext(), undefined as any);
    expect(result).toMatchObject({ status: 401 });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});

describe("withCatchError", () => {
  it("is equivalent to withMiddleware([catchError], handler)", async () => {
    const wrapped = withCatchError(async () => ({
      jsonBody: { ok: true },
    }));

    const result = await wrapped(mockRequest(), mockContext(), undefined as any);
    expect(result).toEqual({ jsonBody: { ok: true } });
  });

  it("catches ZodError and returns 400", async () => {
    const schema = z.object({ x: z.number() });
    const parser = { body: schema };
    const handler: MiddlewareHandler<typeof parser> = async (c) => ({
      jsonBody: c.parsed,
    });
    const wrapped = withCatchError(handler);

    const result = await wrapped(mockRequest({ x: "bad" }), mockContext(), parser);
    expect(result).toMatchObject({ status: 400, jsonBody: { message: "Bad Request" } });
  });
});

describe("handler integration (end-to-end)", () => {
  it("works with http() + withMiddleware + registerAll", async () => {
    const { app, registered } = mockApp();
    const def = http({
      parser: { body: z.object({ name: z.string() }) },
      handler: withCatchError(async (c) => ({
        jsonBody: { greeting: `Hello ${c.parsed.body.name}` },
      })),
    });

    registerAll(app, { greet: def });
    const handler = registered.get("greet")!.handler;
    const result = await handler(mockRequest({ name: "World" }), mockContext());
    expect(result).toEqual({ jsonBody: { greeting: "Hello World" } });
  });
});
