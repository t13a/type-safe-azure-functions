import { authMe } from "./auth-me.js";
import { createTodo } from "./create-todo.js";
import { getTodos } from "./get-todos.js";
import { defs as management } from "./management/index.js";

export const defs = { management, getTodos, createTodo, authMe } as const;
