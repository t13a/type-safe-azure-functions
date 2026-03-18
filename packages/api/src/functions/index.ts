import { checkAuth } from "./check-auth.js";
import { createTodo } from "./create-todo.js";
import { getTodo } from "./get-todo.js";

export const functions = { getTodo, createTodo, checkAuth } as const;
