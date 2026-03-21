import type { HttpFunctionDefinition } from "@my-app/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { createHttpFunctionClient } from "./http-function-client.js";

type Def = HttpFunctionDefinition<undefined, any>;
type DefWithBody = HttpFunctionDefinition<z.ZodObject<{ title: z.ZodString }>, any>;
type Defs = { foo: Def };
type DefsWithBody = { foo: DefWithBody };
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

describe("request construction", () => {
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

describe("header merging", () => {
  it("merges user headers with default content-type", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo({ headers: { authorization: "Bearer token" } });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBe("Bearer token");
  });

  it("allows user to override content-type", async () => {
    const client = createHttpFunctionClient<Defs>("http://example.com");
    await client.foo({ headers: { "Content-Type": "text/plain" } });
    const [, init] = mockFetch.mock.calls[0];
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("text/plain");
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
