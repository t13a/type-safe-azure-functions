# Type-safe Azure Functions

> If you can use [Hono](https://hono.dev/docs/guides/rpc), use Hono. This exists because some of us are not that fortunate.

Type-safe API communication for Azure Functions v4, inspired by Hono RPC and Astro Actions. Response types are inferred from handler implementations — no hand-written response schemas needed.

## How it works

```
defineHttp()              →  Handler + validation in one place (no side effects)
  ↓
registerHttp(app, ...)    →  Registers with app.http() at startup
  ↓
createClient(baseUrl)     →  Typed client, response types flow automatically
```

Change the handler's return value and TypeScript will flag mismatches on both server and client. No code generation required.

## Design constraints

This library trades full Azure Functions compatibility for simplicity. The following conventions are fixed and cannot be overridden:

| Constraint | Value |
|---|---|
| HTTP method | Always `POST` |
| Route | `/api/{functionName}` (function name as-is) |
| Request format | JSON body + HTTP headers (no URL path/query params) |

`methods` and `route` are excluded from `defineHttp` options — specifying them is a compile error. If you need custom routing or other HTTP methods, use `app.http()` directly.

## Project structure

```
packages/
├── api/
│   ├── src/
│   │   ├── lib/
│   │   │   └── http.ts             # defineHttp + registerHttp + defaultErrorHandler + types
│   │   ├── functions/
│   │   │   ├── auth-me.ts
│   │   │   ├── create-todo.ts
│   │   │   ├── index.ts            # Definition map (shared by server and client)
│   │   │   └── list-todos.ts
│   │   ├── app.ts                  # Azure Functions entry point
│   │   └── index.ts                # Re-exports HttpFunctionDefinition, defs map
│   └── package.json
└── client/                         # Usage example / integration tests
    └── src/
        ├── lib/
        │   └── api.ts              # createClient (generic typed fetch wrapper)
        └── example.test.ts
```

## Quick start

```bash
npm install
npx tsc --build
cd packages/api && func start
```

## Running tests

Tests run against a live Azure Functions instance. Start the server first, then run:

```bash
# terminal 1
npx tsc --build
cd packages/api && func start

# terminal 2
cd packages/client && npm test
```

## Defining functions

Use `defineHttp()` to declare a handler with its validation schema. The function name used in `functions/index.ts` becomes both the Azure Functions name and the client method name.

```typescript
import { z } from "zod";
import { defineHttp } from "../lib/http.js";

export const createTodo = defineHttp({
  parser: {
    body: z.object({
      title: z.string().min(1),
      completed: z.boolean().optional().default(false),
    }),
    // parser.body is optional — omit for endpoints that take no input
    // parser.headers is also available — see "Header validation" below
  },
  handler: async (_request, context, { body }) => {
    context.log(`Creating todo: ${body.title}`);

    return {
      jsonBody: {           // ← response type inferred from here
        id: crypto.randomUUID(),
        title: body.title,
        completed: body.completed,
      },
    };
  },
});
```

The options object accepts any `HttpFunctionOptions` from `@azure/functions` **except** `methods`, `route`, and `handler` — those are controlled by the framework. `authLevel`, `retry`, and other options work as-is.

## Header validation

Use `parser.headers` to validate HTTP headers with a Zod schema. The parsed result is available as `parsed.headers` in the handler, fully typed.

```typescript
import { z } from "zod";
import { defaultErrorHandler, defineHttp } from "../lib/http";

type User = { name: string };

const usersByToken = new Map<string, User>().set("my-secret-token", { name: "John Doe"});

const unauthorizedErrorHandler = () => {
  return { status: 401 as const, jsonBody: { message: "Unauthorized" } } as const;
};

export const authMe = defineHttp({
  parser: {
    headers: z.object({
      authorization: z.string().regex(/^Bearer .+$/).transform((arg) => {
        return { token: arg.replace("Bearer ", "") };
      }),
    }),
  },
  handler: async (_request, context, { headers }) => {
    context.log(`Authenticating token: ${headers.authorization.token}`);

    const token = headers.authorization.token;
    const user = usersByToken.get(token);

    if (!user) {
      return unauthorizedErrorHandler();
    }

    return { status: 200, jsonBody: user } as const;
  },
  errorHandler: async (request, context, error) => {
    if (!request.headers.has("authorization")) {
      return unauthorizedErrorHandler();
    }

    return defaultErrorHandler(request, context, error);
  },
});
```

- `parser.headers` is optional — omit it for endpoints that don't need header validation
- When omitted, `parsed.headers` is absent from the handler's third argument (not `undefined`, absent)
- `parser.body` and `parser.headers` can be combined — both are validated in the same request

## Error handling

By default, validation errors return 400 and unhandled exceptions return 500. You can override this per-function with `errorHandler`:

```typescript
import { defaultErrorHandler, defineHttp } from "../lib/http";

export const authMe = defineHttp({
  parser: { /* ... */ },
  handler: async (request, context, parsed) => { /* ... */ },
  errorHandler: async (request, context, error) => {
    // Return 401 instead of 400 when the Authorization header is missing
    if (!request.headers.has("authorization")) {
      return { status: 401 as const, jsonBody: { message: "Unauthorized" } } as const;
    }

    // Fall back to the default behavior for other errors
    return defaultErrorHandler(request, context, error);
  },
});
```

- `errorHandler` receives `request`, `context`, and `error` — must return a `Promise`
- When omitted, `defaultErrorHandler` is used (400 for `ZodError`, 500 for everything else)
- The error handler's return type is inferred and included in the client's response type union, so status code narrowing works for custom error shapes too

## Registering functions

Side effects are isolated to `app.ts`, the Azure Functions entry point:

```typescript
import { registerHttp } from "./lib/http.js";
import { defs } from "./functions/index.js";
import { app } from "@azure/functions";

for (const [name, def] of Object.entries(defs)) {
  registerHttp(app, name, def);
}
```

`registerHttp` takes the `app` instance as its first argument, keeping the module itself side-effect free. The definition map in `functions/index.ts` is shared between server registration and the client.

## Client usage

The client package takes `@my-app/api` as a `devDependency` — only type information is imported, with no runtime dependency on the Azure Functions SDK.

```typescript
import type { defs } from "@my-app/api";
import { createClient } from "./lib/api.js";

const client = createClient<typeof defs>("http://localhost:7071");

// Custom headers can be passed to any endpoint
const authRes = await client.authMe({
  headers: { authorization: "Bearer my-token" },
});

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

// Custom errorHandler shapes are also narrowed
const authRes2 = await client.authMe({
  headers: { authorization: "Bearer my-token" },
});
if (authRes2.status === 200) {
  const user = await authRes2.json();
  // user: { name: string }
} else {
  // status: 401
  const err = await authRes2.json();
  // err: { message: string }
}
```

The client returns a standard `Response` with a typed `json()` method. Check `res.status` yourself — no magic error throwing. Error response shapes are inferred from the server's `errorHandler` (or `defaultErrorHandler` when omitted), so custom error types flow to the client automatically.

Headers are passed as `HeadersInit` (the standard fetch type) — `Record<string, string>`, `Headers`, or `string[][]` all work. User-provided headers are merged with the default `Content-Type: application/json`, and user values take precedence.

## Adding a new endpoint

1. Create a new file in `packages/api/src/functions/` with `defineHttp()`
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

## Prerequisites

- Node.js 18 / 20 / 22
- Azure Functions Core Tools v4 (`npm install -g azure-functions-core-tools@4`)
