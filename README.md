# Type-safe Azure Functions

> If you can use [Hono](https://hono.dev/docs/guides/rpc), use Hono. This exists because some of us are not that fortunate.

Type-safe API communication for Azure Functions v4, inspired by Hono RPC. Response types are inferred from handler implementations — no hand-written response schemas needed.

## How it works

```
defineFunction()          →  Route + handler in one place (no side effects)
  ↓
registerFunction()        →  Registers with app.http() at startup
  ↓
createClient(baseUrl)     →  Typed client, response types flow automatically
```

Change the handler's return value and TypeScript will flag mismatches on both server and client. No code generation required.

## Project structure

```
packages/
├── api/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── define-function.ts   # defineFunction + types (no @azure/functions runtime dep)
│   │   │   ├── register-function.ts # registerFunction (calls app.http())
│   │   │   └── create-client.ts    # Generic typed client
│   │   ├── functions/
│   │   │   ├── index.ts            # Function map (shared by server and client)
│   │   │   ├── get-todo.ts
│   │   │   └── create-todo.ts
│   │   ├── app.ts                  # Azure Functions entry point
│   │   └── index.ts                # createClient (pre-configured with functions)
│   └── package.json
└── client/                         # Usage example
    └── src/
        └── example.ts
```

## Quick start

```bash
npm install
npx tsc --build
cd packages/api && func start
```

## Defining functions

Use `defineFunction()` to declare a route and its handler together. No `as const`, no separate route definitions, no response schemas.

```typescript
import { z } from "zod";
import { defineFunction } from "../lib/define-function.js";

export const createTodo = defineFunction(
  {
    method: "POST",
    route: "todos",
    body: z.object({
      title: z.string().min(1),
      completed: z.boolean().optional().default(false),
    }),
    // params and body are optional — omit when not needed
  },
  async (request, context, { body }) => {
    context.log(`Creating todo: ${body.title}`);

    return {
      jsonBody: {           // ← response type inferred from here
        id: crypto.randomUUID(),
        title: body.title,
        completed: body.completed,
      },
    };
  },
);
```

The handler signature extends the standard Azure Functions convention — `request` and `context` come first, with a single `parsed` argument added for validated input.

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

```typescript
import { createClient } from "@my-app/api";

const client = createClient("http://localhost:7071");

const res = await client.getTodo({ params: { id: "550e8400-..." } });
if (res.ok) {
  const todo = await res.json();
  // todo: { id: string; title: string; completed: boolean }
}

const res2 = await client.createTodo({ body: { title: "Buy milk" } });
const newTodo = await res2.json();
```

The client returns a standard `Response` with a typed `json()` method. Check `res.ok` yourself — no magic error throwing.

## Adding a new endpoint

1. Create a new file in `packages/api/src/functions/` with `defineFunction()`
2. Add it to the function map in `functions/index.ts`
3. Done — the client picks it up automatically

## Response type inference

The response type is inferred from what you return:

| Return shape | Inferred client type |
|---|---|
| `{ jsonBody: { id: string } }` | `{ id: string }` |
| `{ body: "raw string" }` | `unknown` |
| `{ status: 204 }` | `void` |

## Why not X?

**tRPC** — Brings its own router and middleware. Doesn't play well with `app.http()` + `InvocationContext`.

**Hono RPC** — Great, but [hono-azurefunc-adapter](https://github.com/Marplex/hono-azurefunc-adapter) can't pass `InvocationContext` to handlers.

**This** — ~200 lines of application code. No framework, just a pattern.

## Prerequisites

- Node.js 18 / 20 / 22
- Azure Functions Core Tools v4 (`npm install -g azure-functions-core-tools@4`)
