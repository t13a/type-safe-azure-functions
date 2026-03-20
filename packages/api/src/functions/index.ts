import { authMe } from "./auth-me.js";
import { createTodo } from "./create-todo.js";
import { listTodos } from "./list-todos.js";

export const functions = { listTodos, createTodo, authMe } as const;
