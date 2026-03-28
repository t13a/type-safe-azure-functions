# Type-safe Azure Functions

Type-safe API communication for Azure Functions v4, inspired by [Hono RPC](https://hono.dev/docs/guides/rpc) and [Astro Actions](https://docs.astro.build/en/guides/actions/). Response types are inferred from handler implementations — no hand-written response schemas needed.

## Overview

Define a handler on the server — the client gets type-safe access automatically:

```typescript
// Server: define an endpoint
export const getGreeting = http({
  handler: withCatchError(async () => {
    return { jsonBody: { message: "Hello!" } };
  }),
});

// Client: response type is inferred
const res = await client.getGreeting();
if (res.status === 200) {
  const data = await res.json();
  // data: { message: string }
}
```

Change the handler's return value and TypeScript will flag mismatches on both server and client. No code generation required.

## Getting started

### Prerequisites

- Node.js 22
- Azure Functions Core Tools v4 (`npm install -g azure-functions-core-tools@4`)

### Quick start

```bash
npm install
npm run build        # Type-check and compile all packages (tsc -b)
npm run dev
```

### Build & test commands

```bash
npm run build        # One-shot type-check + compile
npm run watch        # Continuous type-check across all packages (tsc -b -w)

npm test             # Unit tests (no type-check — run build/watch separately)

npm run dev          # Start dev server (terminal 1)
npm run test:int     # Integration tests against dev server (terminal 2)
```

### Project structure

```
packages/
├── api/
│   ├── src/
│   │   ├── functions/
│   │   │   ├── management/
│   │   │   │   ├── index.ts              # Nested definition map (imported by ../index.ts)
│   │   │   │   └── get-stats.ts
│   │   │   ├── auth-me.ts
│   │   │   ├── create-todo.ts
│   │   │   ├── get-todos.ts
│   │   │   └── index.ts                  # Definition map (type-shared with client)
│   │   ├── lib/
│   │   │   └── http-function-v2/
│   │   │       ├── index.ts
│   │   │       ├── core.ts
│   │   │       ├── core.test.ts
│   │   │       ├── middleware.ts
│   │   │       └── middleware.test.ts
│   │   ├── app.ts                        # Azure Functions entry point
│   │   └── index.ts
│   └── package.json
└── client/
    ├── src/
    │   ├── lib/
    │   │   ├── http-function-client.ts
    │   │   └── http-function-client.test.ts
    │   └── example.int.test.ts
    └── package.json
package.json
```

## Usage

### 1. Define an endpoint

Create a file in `packages/api/src/functions/`:

```typescript
import { z } from "zod";
import { http, withCatchError } from "../lib/http-function-v2/index.js";

export const createTodo = http({
  parser: {
    body: z.object({
      title: z.string().min(1),
      completed: z.boolean().optional().default(false),
    }),
  },
  handler: withCatchError(async (c) => {
    c.context.log(`Creating todo: ${c.parsed.body.title}`);

    return {
      jsonBody: { // ← response type inferred from here
        id: crypto.randomUUID(),
        title: c.parsed.body.title,
        completed: c.parsed.body.completed,
      },
    };
  }),
});
```

The `parser` option accepts `{ query?, body? }` to validate URL query parameters and/or the request body. `withCatchError` handles `ZodError` (400), `SyntaxError` (400), and unhandled exceptions (500).

### 2. Register it

Add the endpoint to the definition map and it's done — the client picks it up automatically:

```typescript
// functions/index.ts
export const defs = { createTodo, getTodos, /* ... */ } as const;
```

```typescript
// app.ts — Azure Functions entry point (the only file with side effects)
import { registerAll } from "./lib/http-function-v2/index.js";
import { defs } from "./functions/index.js";
import { app } from "@azure/functions";

registerAll(app, defs);
```

Routes and HTTP methods are derived from the definition tree:

```
createTodo        → POST /api/createTodo
getTodos          → GET  /api/getTodos
```

### 3. Call from the client

The client package takes `@my-app/api` as a `devDependency` — only type information is imported, with no runtime dependency on the Azure Functions SDK.

```typescript
import type { defs } from "@my-app/api";
import { createHttpFunctionClient } from "./lib/http-function-client.js";

const client = createHttpFunctionClient<typeof defs>("http://localhost:7071");

// GET with optional query params
const allTodos = await client.getTodos();
const completedTodos = await client.getTodos({ query: { completed: "true" } });

// POST with body (required)
const res = await client.createTodo({ body: { title: "Buy milk" } });
```

Status codes narrow the response body type — this works for both handler return types and middleware return types:

```typescript
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
```

### Middleware

Middleware wraps the handler and can short-circuit the request (e.g. return 401) or delegate to the handler via `next()`.

```typescript
import {
  http,
  withMiddleware,
  createVariableKey,
  catchError,
  type Middleware,
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
}) satisfies Middleware;

export const authMe = http({
  handler: withMiddleware([requireAuth, catchError], async (c) => {
    const user = c.vars.get(userKey)!;
    return { status: 200, jsonBody: user } as const;
  }),
});
```

## Reference

### `http()` options

`http()` accepts any `HttpFunctionOptions` from `@azure/functions` with the following restrictions:

| Option | Behavior |
|---|---|
| `methods` | Not configurable. `GET` for keys starting with `get`, otherwise `POST` |
| `route` | Not configurable. Derived from definition tree keys (e.g. `/api/getTodos`) |
| `parser` | `{ query?, body? }` — Zod schemas for URL query params and/or request body |
| `handler` | Required. Wrapped with `withMiddleware` or `withCatchError` |
| Others | `authLevel`, `retry`, etc. work as-is |

Specifying `methods` or `route` is a compile error. If you need custom routing or other HTTP methods, use `app.http()` directly.

**`parser` and `c.parsed`:**

| Parser | `c.parsed` type |
|---|---|
| omitted | `void` |
| `{ query: schema }` | `{ query: z.infer<schema> }` |
| `{ body: schema }` | `{ body: z.infer<schema> }` |
| `{ query: ..., body: ... }` | `{ query: ..., body: ... }` |

Query parameter values are always strings. Use Zod transforms or `z.coerce.*` to convert them:

```typescript
export const getTodos = http({
  parser: {
    query: z.object({
      completed: z.string().transform(s => s === "true").optional(),
    }),
  },
  handler: withCatchError(async (c) => {
    const todos = [ /* ... */ ];
    const { completed } = c.parsed.query;
    return {
      jsonBody: completed === undefined ? todos : todos.filter(t => t.completed === completed),
    };
  }),
});
```

### Nested definition maps

Definition maps can be nested to create path-based routing. `registerAll` traverses the tree and generates routes from the key hierarchy:

```typescript
// functions/management/index.ts
import { getStats } from "./get-stats.js";
export const defs = { getStats } as const;

// functions/index.ts
import { defs as management } from "./management/index.js";
export const defs = { management, /* ... */ } as const;
```

The client mirrors the same structure:

```typescript
const res = await client.management.getStats();
```

### Middleware details

- Middleware receives a single context object `c` with `request`, `context`, `vars`, and `next` properties
- `c.vars` is a typed key-value store (`createVariableKey<T>()`) for passing data between middleware and handlers
- Middleware can return its own response to short-circuit, or call `c.next()` to invoke the handler
- Middleware cannot modify the handler's response (read-only) — return `void` or your own response
- The middleware's return type is inferred and included in the client's response type union, so status code narrowing works for custom error shapes too
- Use `withMiddleware([m1, m2, ...], handler)` to compose multiple middlewares — they execute in order, and the combined response type is the union of all middlewares' return types
- `withCatchError(handler)` is a shortcut for `withMiddleware([catchError], handler)`

### Client behavior

The client automatically determines the HTTP method from the endpoint name:
- Names starting with `get` → `GET` request: query params are serialized into the URL, no request body is sent
- All other names → `POST` request: input is JSON-serialized as the request body

For `GET` endpoints, the `query` field in the client input maps directly to URL query parameters. If all fields in the query schema are optional, `input` itself is also optional. If any field is required, the caller must provide `query`.

Headers are passed as `HeadersInit` (the standard fetch type) — `Record<string, string>`, `Headers`, or `string[][]` all work. For `POST` requests, user-provided headers are merged with the default `Content-Type: application/json`, and user values take precedence.

### Response type inference

The response type is inferred from what you return. The status code defaults to `200` when omitted:

| Return shape | Inferred status | Inferred body |
|---|---|---|
| `{ jsonBody: { id: string } }` | `200` | `{ id: string }` |
| `{ status: 201 as const, jsonBody: { id: string } }` | `201` | `{ id: string }` |
| `{ body: "raw string" }` | `200` | `unknown` |
| `{ status: 204 as const }` | `204` | `void` |

### Why not X?

**tRPC** — Brings its own router and middleware. Doesn't play well with `app.http()` + `InvocationContext`.

**Hono RPC** — Great, but [hono-azurefunc-adapter](https://github.com/Marplex/hono-azurefunc-adapter) can't pass `InvocationContext` to handlers.

**This** — ~350 lines of library code across 3 files. Not a framework — a set of typed wrappers around `app.http()` and `fetch`.
