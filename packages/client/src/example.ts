import { createClient } from "@my-app/api";

const client = createClient("http://localhost:7071");

async function main() {
  const res = await client.getTodo({ params: { id: "550e8400-e29b-41d4-a716-446655440000" } });
  if (res.ok) {
    const todo = await res.json();
    console.log(todo.title);
    console.log(todo.completed);
  }

  const res2 = await client.createTodo({ body: { title: "Buy milk" } });
  const newTodo = await res2.json();
  console.log(newTodo.id);
}

main();
