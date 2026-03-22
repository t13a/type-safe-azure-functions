# Type-safe Azure Functions

> If you can use Hono, use Hono. This exists because some of us are not that fortunate.

Type-safe API communication for Azure Functions v4, inspired by [Hono RPC](https://hono.dev/docs/guides/rpc) and [Astro Actions](https://docs.astro.build/en/guides/actions/). Response types are inferred from handler implementations — no hand-written response schemas needed.

## How it works

```
http()                    →  Handler + validation in one place (no side effects)
  ↓
registerAll(app, ...)     →  Registers with app.http() at startup (path-based routing from definition tree)
  ↓
createClient(baseUrl)     →  Typed client, response types flow automatically
```

Change the handler's return value and TypeScript will flag mismatches on both server and client. No code generation required.

## Design constraints

This library trades full Azure Functions compatibility for simplicity. The following conventions are fixed and cannot be overridden:

| Constraint | Value |
|---|---|
| HTTP method | Always `POST` |
| Route | `/api/{path}` (derived from definition tree keys) |
| Request format | JSON body + HTTP headers (no URL path/query params) |

`methods` and `route` are excluded from `http()` options — specifying them is a compile error. If you need custom routing or other HTTP methods, use `app.http()` directly.

## Project structure

```
packages/
├── api/
│   ├── src/
│   │   ├── functions/
│   │   │   ├── management/
│   │   │   │   ├── index.ts              # Nested definition map
│   │   │   │   └── show-stats.ts
│   │   │   ├── auth-me.ts
│   │   │   ├── create-todo.ts
│   │   │   ├── index.ts                  # Root definition map (shared by server and client)
│   │   │   └── list-todos.ts
│   │   ├── lib/
│   │   │   └── http-function-v2/
│   │   │       ├── index.ts              # Barrel re-export
│   │   │       ├── core.ts               # Endpoint definition, routing, registration
│   │   │       ├── core.test.ts
│   │   │       ├── middleware.ts          # Middleware, vars, withMiddleware
│   │   │       └── middleware.test.ts
│   │   ├── app.ts                        # Azure Functions entry point
│   │   └── index.ts                      # Re-exports definition map, types
│   └── package.json
└── client/                               # Usage example / integration tests
    ├── src/
    │   ├── lib/
    │   │   ├── http-function-client.ts      # Generic typed fetch wrapper
    │   │   └── http-function-client.test.ts
    │   └── example.int.test.ts
    └── package.json
package.json
```

## Prerequisites

- Node.js 22
- Azure Functions Core Tools v4 (`npm install -g azure-functions-core-tools@4`)

## Quick start

```bash
npm install
npm run build        # Type-check and compile all packages (tsc -b)
npm run dev
```

## Type checking

```bash
npm run build        # One-shot type-check + compile
npm run watch        # Continuous type-check across all packages (tsc -b -w)
```

`npm test` (Vitest) does **not** include type checking. Run `npm run build` or `npm run watch` separately to catch type errors across package boundaries.

## Running tests

```bash
# Unit tests (no server required)
npm test

# Integration tests (requires the dev server)
npm run dev          # terminal 1
npm run test:int     # terminal 2
```

## Defining functions

Use `http()` to declare an endpoint with its validation schema. The function name used in `functions/index.ts` becomes both the Azure Functions name and the client method name.

```typescript
import { z } from "zod";
import { http, withDefaultMiddleware } from "../lib/http-function-v2/index.js";

export const createTodo = http({
  parser: z.object({
    title: z.string().min(1),
    completed: z.boolean().optional().default(false),
  }),
  handler: withDefaultMiddleware(async (c) => {
    c.context.log(`Creating todo: ${c.parsed.title}`);

    return {
      jsonBody: { // ← response type inferred from here
        id: crypto.randomUUID(),
        title: c.parsed.title,
        completed: c.parsed.completed,
      },
    };
  }),
});
```

- `http()` defines an endpoint. The `handler` receives `(request, context, parser)` — but when wrapped with `withDefaultMiddleware` or `withMiddleware`, the handler receives a context object `c` with `request`, `context`, `vars`, and `parsed` properties instead
- `parser` takes a Zod schema directly — the parsed result is available via `c.parsed`
- When `parser` is omitted, `c.parsed` is typed as `void`
- `withDefaultMiddleware(handler)` is a shortcut for `withMiddleware([defaultMiddleware], handler)` — it handles `ZodError` (400), `SyntaxError` (400), and unhandled exceptions (500)
- The options object accepts any `HttpFunctionOptions` from `@azure/functions` **except** `methods`, `route`, and `handler` — those are controlled by the framework. `authLevel`, `retry`, and other options work as-is.

## Middleware

Middleware wraps the handler and can short-circuit the request (e.g. return 401) or delegate to the handler via `next()`. Use `withMiddleware([...], handler)` to compose middlewares with a handler.

```typescript
import {
  http,
  withMiddleware,
  createVariableKey,
  defaultMiddleware,
  type HttpMiddleware,
} from "../lib/http-function-v2/index.js";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", {
  name: "John Doe",
});

const unauthorizedResponse = {
  status: 401,
  jsonBody: { message: "Unauthorized" },
} as const;

export const userKey = createVariableKey<User>("user");

const requireAuth = (async (c) => {
  const authHeader = c.request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorizedResponse;
  }
  const user = usersByToken.get(authHeader.replace("Bearer ", ""));
  if (!user) {
    return unauthorizedResponse;
  }
  c.vars.set(userKey, user);
  await c.next();
}) satisfies HttpMiddleware;

export const authMe = http({
  handler: withMiddleware([requireAuth, defaultMiddleware], async (c) => {
    const user = c.vars.get(userKey)!;
    return { status: 200, jsonBody: user } as const;
  }),
});
```

- Middleware receives a single context object `c` with `request`, `context`, `vars`, and `next` properties
- `c.vars` is a typed key-value store (`createVariableKey<T>()`) for passing data between middleware and handlers
- Middleware can return its own response to short-circuit, or call `c.next()` to invoke the handler
- Middleware cannot modify the handler's response (read-only) — return `void` or your own response
- The middleware's return type is inferred and included in the client's response type union, so status code narrowing works for custom error shapes too
- Use `withMiddleware([m1, m2, ...], handler)` to compose multiple middlewares — they execute in order, and the combined response type is the union of all middlewares' return types

## Nested definition maps

Definition maps can be nested using `subRoute()` to create path-based routing. `registerAll` traverses the tree and generates routes from the key hierarchy:

```typescript
// functions/management/index.ts
import { showStats } from "./show-stats.js";
export const defs = { showStats } as const;

// functions/index.ts
import { subRoute } from "../lib/http-function-v2/index.js";
import { defs as managementDefs } from "./management/index.js";

const management = subRoute(managementDefs);
export const defs = { management, listTodos, createTodo, authMe } as const;
```

This registers `showStats` at `/api/management/showStats`. The client mirrors the same structure:

```typescript
const res = await client.management.showStats();
```

## Registering functions

Side effects are isolated to `app.ts`, the Azure Functions entry point:

```typescript
import { registerAll } from "./lib/http-function-v2/index.js";
import { defs } from "./functions/index.js";
import { app } from "@azure/functions";

registerAll(app, defs);
```

`registerAll` takes the `app` instance as its first argument, keeping the module itself side-effect free. The definition map in `functions/index.ts` is shared between server registration and the client.

## Client usage

The client package takes `@my-app/api` as a `devDependency` — only type information is imported, with no runtime dependency on the Azure Functions SDK.

```typescript
import type { defs } from "@my-app/api";
import { createHttpFunctionClient } from "./lib/http-function-client.js";

const client = createHttpFunctionClient<typeof defs>("http://localhost:7071");

// Status code narrows the json() return type
const res = await client.createTodo({ body: { title: "Buy milk" } });
if (res.status === 200) {
  const todo = await res.json();
  // todo: { id: string; title: string; completed: boolean }
} else if (res.status === 400) {
  const err = await res.json();
  // err: { message: string; errors: ZodError.flatten() result }
} else {
  const err = await res.json();
  // err: { message: string }
}

// Middleware return types are also narrowed
const authRes = await client.authMe({
  headers: { authorization: "Bearer my-secret-token" },
});
if (authRes.status === 200) {
  const user = await authRes.json();
  // user: { name: string }
} else if (authRes.status === 401) {
  const err = await authRes.json();
  // err: { message: string }
}
```

The client returns a standard `Response` with a typed `json()` method. Check `res.status` yourself — no magic error throwing. Error response shapes are inferred from the server's middleware (or `defaultMiddleware` when omitted), so custom error types flow to the client automatically.

Headers are passed as `HeadersInit` (the standard fetch type) — `Record<string, string>`, `Headers`, or `string[][]` all work. User-provided headers are merged with the default `Content-Type: application/json`, and user values take precedence.

## Adding a new endpoint

1. Create a new file in `packages/api/src/functions/` with `http()`
2. Add it to the definition map in `functions/index.ts`
3. Done — the client picks it up automatically

## Response type inference

The response type is inferred from what you return. The status code defaults to `200` when omitted:

| Return shape | Inferred status | Inferred body |
|---|---|---|
| `{ jsonBody: { id: string } }` | `200` | `{ id: string }` |
| `{ status: 201 as const, jsonBody: { id: string } }` | `201` | `{ id: string }` |
| `{ body: "raw string" }` | `200` | `unknown` |
| `{ status: 204 as const }` | `204` | `void` |

## Why not X?

**tRPC** — Brings its own router and middleware. Doesn't play well with `app.http()` + `InvocationContext`.

**Hono RPC** — Great, but [hono-azurefunc-adapter](https://github.com/Marplex/hono-azurefunc-adapter) can't pass `InvocationContext` to handlers.

**This** — ~200 lines of application code. No framework, just a pattern.
