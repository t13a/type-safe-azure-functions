import { createClient } from "./api-client.js";
import { getTodo, createTodo } from "@my-app/api";

const client = createClient("http://localhost:7071", { getTodo, createTodo });

async function main() {
  // GET /api/todos/{id} — params 必須、body なし
  const res = await client.getTodo({ params: { id: "550e8400-e29b-41d4-a716-446655440000" } });
  if (res.ok) {
    const todo = await res.json();
    console.log(todo.title);
    console.log(todo.completed);
  }

  // POST /api/todos — params なし、body 必須
  const res2 = await client.createTodo({ body: { title: "Buy milk" } });
  console.log(res2.status);
  const newTodo = await res2.json();
  console.log(newTodo.id);
}

main();
