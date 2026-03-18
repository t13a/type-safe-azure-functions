import type { functions } from "@my-app/api";
import { createClient } from "./lib/create-client.js";
import { describe, expect, it } from "vitest";

const client = createClient<typeof functions>("http://localhost:7071");

describe("todo API", () => {
  it("gets a todo", async () => {
    const res = await client.getTodo({ body: { id: "550e8400-e29b-41d4-a716-446655440000" } });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const todo = await res.json();
    expect(todo.title).toBe("Sample todo");
    expect(todo.completed).toBe(false);
  });

  it("creates a todo", async () => {
    const res = await client.createTodo({ body: { title: "Buy milk" } });
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const todo = await res.json();
    expect(todo.id).toBeTypeOf("string");
    expect(todo.title).toBe("Buy milk");
    expect(todo.completed).toBe(false);
  });

  it("returns 400 for invalid input", async () => {
    const res = await client.getTodo({ body: { id: "not-a-uuid" } });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    const err = await res.json();
    expect(err.errors).toBeDefined();
  });

  it("returns 400 for invalid body", async () => {
    const res = await client.createTodo({ body: { title: "" } });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    const err = await res.json();
    expect(err.errors).toBeDefined();
  });
});
