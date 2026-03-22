import { authMe } from "./auth-me.js";
import { createTodo } from "./create-todo.js";
import { listTodos } from "./list-todos.js";
import { defs as management } from "./management/index.js";

export const defs = { management, listTodos, createTodo, authMe } as const;
