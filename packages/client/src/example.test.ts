import type { defs } from "@my-app/api";
import { createClient } from "./lib/api.js";
import { describe, expect, it } from "vitest";

const client = createClient<typeof defs>("http://localhost:7071");

describe("todo API", () => {
  it("list all todos", async () => {
    const res = await client.listTodos();
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const todos = await res.json();
    expect(todos[0].title).toBe("Wake early");
    expect(todos[0].completed).toBe(true);
    expect(todos[1].title).toBe("Sleep early");
    expect(todos[1].completed).toBe(false);
  });

  it("creates a todo", async () => {
    const res = await client.createTodo({ body: { title: "Buy milk" } });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const todo = await res.json();
    expect(todo.id).toBeTypeOf("string");
    expect(todo.title).toBe("Buy milk");
    expect(todo.completed).toBe(false);
  });

  it("returns 400 for invalid body", async () => {
    const res = await client.createTodo({ body: { title: "" } });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    const err = await res.json();
    expect(err.message).toBe("Bad Request");
    expect(err.errors).toBeDefined();
  });

  it("authenticates with valid token", async () => {
    const res = await client.authMe({
      headers: { authorization: "Bearer my-secret-token" },
    });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const user = await res.json();
    expect(user.name).toBe("John Doe");
  });

  it("returns 401 for invalid header", async () => {
    const res = await client.authMe({
      headers: { authorization: "Bearer invalid-token" },
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    const err = await res.json();
    expect(err.message).toBe("Unauthorized");
  });

  it("returns 401 for missing header", async () => {
    const res = await client.authMe();
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
    const err = await res.json();
    expect(err.message).toBe("Unauthorized");
  });
});
