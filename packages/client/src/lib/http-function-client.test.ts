import type { HttpFunctionDefinition } from "@my-app/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { createHttpFunctionClient } from "./http-function-client.js";

type Def = HttpFunctionDefinition<undefined, any>;
type DefWithBody = HttpFunctionDefinition<{ body: z.ZodObject<{ title: z.ZodString }> }, any>;
type DefWithQuery = HttpFunctionDefinition<
  { query: z.ZodObject<{ completed: z.ZodOptional<z.ZodString> }> },
  any
>;
type DefWithRequiredQuery = HttpFunctionDefinition<
  { query: z.ZodObject<{ id: z.ZodString }> },
  any
>;
type Defs = { foo: Def };
type DefsWithBody = { foo: DefWithBody };
type DefsWithQuery = { getTodos: DefWithQuery };
type DefsWithRequiredQuery = { getItem: DefWithRequiredQuery };
type NestedDefs = { a: { b: Def } };

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockResolvedValue(new Response());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("path building", () => {
  it("calls /api/{name} for a top-level method", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo();
    expect(mockFetch).toHaveBeenCalledWith("http://example.com/api/foo", expect.anything());
  });

  it("calls /api/{a}/{b} for a nested method", async () => {
    const client = createHttpFunctionClient<NestedDefs>("http://example.com");
    await client.a.b();
    expect(mockFetch).toHaveBeenCalledWith("http://example.com/api/a/b", expect.anything());
  });

  it("does not resolve as a thenable", () => {
    const client = createHttpFunctionClient<any>("http://example.com");
    expect((client as any).then).toBeUndefined();
  });
});

describe("POST request construction", () => {
  it("sends POST with JSON content-type by default", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo();
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("sends body as JSON", async () => {
    const client = createHttpFunctionClient<DefsWithBody>("http://example.com");
    await client.foo({ body: { title: "hello" } });
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({ title: "hello" }));
  });

  it("sends empty object when body is omitted", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo();
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.body).toBe(JSON.stringify({}));
  });
});

describe("GET request construction", () => {
  it("sends GET request for top-level method starting with 'get'", async () => {
    const client = createHttpFunctionClient<DefsWithQuery>("http://example.com");
    await client.getTodos();
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.method).toBe("GET");
  });

  it("does not send Content-Type header for GET requests", async () => {
    const client = createHttpFunctionClient<DefsWithQuery>("http://example.com");
    await client.getTodos();
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("content-type")).toBeNull();
  });

  it("does not send a body for GET requests", async () => {
    const client = createHttpFunctionClient<DefsWithQuery>("http://example.com");
    await client.getTodos();
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.body).toBeUndefined();
  });

  it("appends query params to URL for GET requests", async () => {
    const client = createHttpFunctionClient<DefsWithQuery>("http://example.com");
    await client.getTodos({ query: { completed: "true" } });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://example.com/api/getTodos?completed=true");
  });

  it("omits undefined query values from URL", async () => {
    const client = createHttpFunctionClient<DefsWithQuery>("http://example.com");
    await client.getTodos({ query: { completed: undefined } });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://example.com/api/getTodos");
  });

  it("sends GET for nested method starting with 'get'", async () => {
    type NestedGetDefs = { management: { getStats: Def } };
    const client = createHttpFunctionClient<NestedGetDefs>("http://example.com");
    await client.management.getStats();
    const [, init] = mockFetch.mock.calls[0];
    expect(init?.method).toBe("GET");
  });
});

describe("header merging", () => {
  it("merges user headers with default content-type for POST", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo({ headers: { authorization: "Bearer token" } });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer token");
  });

  it("allows user to override content-type for POST", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo({ headers: { "Content-Type": "text/plain" } });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("text/plain");
  });

  it("merges user headers for GET requests", async () => {
    const client = createHttpFunctionClient<DefsWithQuery>("http://example.com");
    await client.getTodos({ headers: { authorization: "Bearer token" } });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer token");
  });

  it("accepts Headers instance", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo({ headers: new Headers({ "x-custom": "value" }) });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("x-custom")).toBe("value");
  });

  it("accepts header entries array", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo({ headers: [["x-custom", "value"]] });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("x-custom")).toBe("value");
  });
});
