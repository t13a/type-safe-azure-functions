import { createClient } from "@my-app/api";
import { describe, expect, it } from "vitest";

const client = createClient("http://localhost:7071");

describe("todo API", () => {
  it("gets a todo", async () => {
    const res = await client.getTodo({
      params: { id: "550e8400-e29b-41d4-a716-446655440000" },
    });
    expect(res.ok).toBe(true);
    const todo = await res.json();
    expect(todo.title).toBe("Sample todo");
    expect(todo.completed).toBe(false);
  });

  it("creates a todo", async () => {
    const res = await client.createTodo({ body: { title: "Buy milk" } });
    expect(res.ok).toBe(true);
    const todo = await res.json();
    expect(todo.id).toBeTypeOf("string");
    expect(todo.title).toBe("Buy milk");
    expect(todo.completed).toBe(false);
  });
});
