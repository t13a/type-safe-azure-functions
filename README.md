# azure-functions-hands-on

Azure Functions v4 + TypeScript + Zod で型安全な API 通信を実現する実験プロジェクト。

## 何をしているのか

Zod スキーマを **単一の情報源** として、サーバー (Azure Functions) とクライアント (ブラウザ fetch) の間でリクエスト・レスポンスの型を共有する。tRPC や Hono RPC に似た体験を、Azure Functions のプログラミングモデル (`app.http()` + `InvocationContext`) を壊さずに得る。

```
routes.ts (Zod スキーマ)
    │
    ├──→ API ハンドラー: リクエスト検証 + レスポンス検証 + 型推論
    │
    └──→ クライアント: 型安全な fetch + 型推論
```

スキーマを変更すれば、TypeScript が即座にサーバーとクライアントの両方で型エラーを出す。コード生成は不要。

## プロジェクト構成

```
packages/
├── shared/   Zod ルート定義（型の単一の情報源）
├── api/      Azure Functions ハンドラー
└── client/   型安全な fetch ラッパー
```

npm workspaces と TypeScript project references で接続している。

## 使い方

```bash
npm install
npx tsc --build
cd packages/api && func start
```

## 仕組み

### 1. ルート定義 (`packages/shared/src/routes.ts`)

`defineRoute()` で HTTP メソッド、パス、パラメータ、ボディ、レスポンスの Zod スキーマをまとめて定義する。

```typescript
import { z } from "zod";
import { defineRoute } from "./typed-api.js";

export const TodoSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  completed: z.boolean(),
});

export const getTodo = defineRoute({
  method: "GET" as const,
  route: "todos/{id}",
  params: z.object({ id: z.string().uuid() }),
  body: z.void(),
  response: TodoSchema,
});

export const createTodo = defineRoute({
  method: "POST" as const,
  route: "todos",
  params: z.object({}),
  body: z.object({
    title: z.string().min(1),
    completed: z.boolean().optional().default(false),
  }),
  response: TodoSchema,
});
```

`defineRoute()` はただの identity 関数で、TypeScript にジェネリクスを推論させるためだけに存在する。ランタイムコストはゼロ。

### 2. API ハンドラー (`packages/api/src/functions/`)

`registerRoute()` がルート定義を受け取り、`app.http()` の登録と Zod バリデーションを自動で行う。

```typescript
import { registerRoute } from "../helpers/validated-handler.js";
import { createTodo } from "@my-app/shared";

registerRoute("createTodo", createTodo, async (req) => {
  // req.body.title は string 型 (Zod スキーマから推論)
  // req.context は InvocationContext (Azure Functions のまま)
  req.context.log(`Creating todo: ${req.body.title}`);

  return {
    id: crypto.randomUUID(),
    title: req.body.title,
    completed: req.body.completed,
  };
  // 戻り値が TodoSchema に合わない → コンパイルエラー
});
```

ハンドラーが受け取る `req` の中身:

| プロパティ | 型 | 説明 |
|---|---|---|
| `params` | Zod スキーマから推論 | パスパラメータ (検証済み) |
| `body` | Zod スキーマから推論 | リクエストボディ (検証済み) |
| `context` | `InvocationContext` | Azure Functions のコンテキスト |
| `raw` | `HttpRequest` | 生のリクエスト (ヘッダー、クエリ等) |

バリデーションエラー時は自動的に 400 + 構造化エラーを返す:

```json
{ "errors": { "fieldErrors": { "id": ["Invalid uuid"] } } }
```

### 3. クライアント (`packages/client/src/api-client.ts`)

```typescript
import { createApiClient } from "@my-app/client";
import { getTodo, createTodo } from "@my-app/shared";

const api = createApiClient("http://localhost:7071");

// GET — params のみ
const todo = await api.request(getTodo, { id: "550e8400-..." });
//    ^? { id: string; title: string; completed: boolean }

// POST — params + body
const newTodo = await api.request(createTodo, {}, { title: "Buy milk" });

// コンパイルエラーの例:
await api.request(getTodo, { id: 123 });        // number は不可
await api.request(createTodo, {}, {});           // title は必須
```

GET/DELETE は body 引数なし、POST/PUT/PATCH は body 引数あり — ルート定義の `method` から自動判定される。

## `defineRoute()` の型定義 (`packages/shared/src/typed-api.ts`)

全体で約 30 行:

```typescript
import { z } from "zod";

export interface RouteDefinition<
  TMethod extends string,
  TPath extends string,
  TParams extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
> {
  method: TMethod;
  route: TPath;
  params: TParams;
  body: TBody;
  response: TResponse;
}

export function defineRoute<
  TMethod extends string,
  TPath extends string,
  TParams extends z.ZodTypeAny,
  TBody extends z.ZodTypeAny,
  TResponse extends z.ZodTypeAny,
>(def: RouteDefinition<TMethod, TPath, TParams, TBody, TResponse>) {
  return def;
}

export type InferParams<R> =
  R extends RouteDefinition<any, any, infer P, any, any> ? z.infer<P> : never;
export type InferBody<R> =
  R extends RouteDefinition<any, any, any, infer B, any> ? z.infer<B> : never;
export type InferResponse<R> =
  R extends RouteDefinition<any, any, any, any, infer Res>
    ? z.infer<Res>
    : never;
```

## 設計判断メモ

**なぜ tRPC を使わないのか** — tRPC は独自のルーターとミドルウェア体系を持ち込む。Azure Functions の `app.http()` + `InvocationContext` と噛み合わせるのが難しく、依存も大きい。ここでは全体で約 150 行のアプリケーションコードで同等の型安全性を得ている。

**なぜ Hono RPC を使わないのか** — [hono-azurefunc-adapter](https://github.com/Marplex/hono-azurefunc-adapter) 経由で Azure Functions 上に Hono を載せることはできるが、関数内で `InvocationContext` を扱えないという制約がある。

**`z.void()` でボディなしを表現** — `z.infer<z.ZodVoid>` は `void` になる。クライアント側の条件付き引数と自然に噛み合う。

**レスポンスも検証する理由** — ハンドラーが契約と異なるデータを返すバグを開発中に即座に検出できる。本番では `route.response.parse()` を外してパフォーマンスを優先してもよい。

**`raw` (HttpRequest) を渡す理由** — ヘッダー、クエリパラメータ、ストリーミングなど、Zod スキーマでカバーしきれない部分へのエスケープハッチ。

## エンドポイントの追加方法

1. `packages/shared/src/routes.ts` に `defineRoute()` を追加し、`index.ts` から export する
2. `packages/api/src/functions/` に新しいファイルを作り `registerRoute()` で登録する
3. 終わり — クライアントは `api.request(newRoute, ...)` で型安全に呼び出せる

## 前提環境

- Node.js 18 / 20 / 22
- Azure Functions Core Tools v4 (`npm install -g azure-functions-core-tools@4`)
