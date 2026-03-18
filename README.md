# Type-safe Azure Functions

> If you can use [Hono](https://hono.dev/docs/guides/rpc), use Hono. This exists because some of us are not that fortunate.

Type-safe API communication for Azure Functions v4, inspired by Hono RPC. Response types are inferred from handler implementations — no hand-written response schemas needed.

## How it works

```
defineFunction()          →  Handler + validation in one place (no side effects)
  ↓
registerFunction()        →  Registers with app.http() at startup
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
| Request format | JSON body only (no URL path/query params) |

`methods` and `route` are excluded from `defineFunction` options — specifying them is a compile error. If you need custom routing or other HTTP methods, use `app.http()` directly.

## Project structure

```
packages/
├── api/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── define-function.ts   # defineFunction + types (no @azure/functions runtime dep)
│   │   │   └── register-function.ts # registerFunction (calls app.http())
│   │   ├── functions/
│   │   │   ├── index.ts            # Function map (shared by server and client)
│   │   │   ├── get-todo.ts
│   │   │   └── create-todo.ts
│   │   ├── app.ts                  # Azure Functions entry point
│   │   └── index.ts                # Re-exports FunctionDefinition, functions map
│   └── package.json
└── client/                         # Usage example / integration tests
    └── src/
        ├── create-client.ts        # createClient (generic typed fetch wrapper)
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

Use `defineFunction()` to declare a handler with its validation schema. The function name used in `functions/index.ts` becomes both the Azure Functions name and the client method name.

```typescript
import { z } from "zod";
import { defineFunction } from "../lib/define-function.js";

export const createTodo = defineFunction({
  authLevel: "anonymous",
  parse: {
    body: z.object({
      title: z.string().min(1),
      completed: z.boolean().optional().default(false),
    }),
    // parse.body is optional — omit for endpoints that take no input
  },
  handler: async (request, context, { body }) => {
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

## Registering functions

Side effects are isolated to `app.ts`, the Azure Functions entry point:

```typescript
import { registerFunction } from "./lib/register-function.js";
import { functions } from "./functions/index.js";

for (const [name, def] of Object.entries(functions)) {
  registerFunction(name, def);
}
```

The function map in `functions/index.ts` is shared between server registration and the client.

## Client usage

The client package takes `@my-app/api` as a `devDependency` — only type information is imported, with no runtime dependency on the Azure Functions SDK.

```typescript
import type { functions } from "@my-app/api";
import { createClient } from "./create-client.js";

const client = createClient<typeof functions>("http://localhost:7071");

// Status code narrows the json() return type
const res = await client.getTodo({ body: { id: "550e8400-..." } });
if (res.status === 200) {
  const todo = await res.json();
  // todo: { id: string; title: string; completed: boolean }
} else if (res.status === 400) {
  const err = await res.json();
  // err: { errors: ZodError.flatten() result }
} else {
  const err = await res.json();
  // err: { error: string }
}
```

The client returns a standard `Response` with a typed `json()` method. Check `res.status` yourself — no magic error throwing. Validation errors (400) and unhandled exceptions (500) have fixed response shapes derived from the server implementation.

## Adding a new endpoint

1. Create a new file in `packages/api/src/functions/` with `defineFunction()`
2. Add it to the function map in `functions/index.ts`
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
